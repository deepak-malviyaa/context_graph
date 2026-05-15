"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Box, Flex, Heading, Text, Textarea, IconButton, VStack, HStack,
  Badge, Button, Spinner, Skeleton, Collapsible, Timeline, Circle,
} from "@chakra-ui/react";
import { Send, RotateCcw, ChevronDown, Wrench, Check, Bot, User, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { API_BASE, DEMO_SCENARIOS, DOMAIN } from "@/lib/config";
import type { GraphData } from "@/lib/config";

interface ToolCall {
  name: string;
  inputs: Record<string, unknown>;
  output_preview: string;
  status: "running" | "complete";
  graph_data?: GraphData;
}

interface ExtractedEntity {
  name: string;
  type: string;
  subtype?: string;
}

interface DetectedPreference {
  category: string;
  preference: string;
  confidence?: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  retryInput?: string;
  entities?: ExtractedEntity[];
  preferences?: DetectedPreference[];
}

interface ChatInterfaceProps {
  onGraphUpdate?: (data: GraphData) => void;
  externalInput?: string | null;
  onExternalInputConsumed?: () => void;
}

const STORAGE_KEY = `ccg-chat-history-${DOMAIN.id}`;
const SESSION_KEY = `ccg-session-id-${DOMAIN.id}`;

const THINKING_PATTERNS = [
  /^let me /i, /^i'll /i, /^i will /i, /^first,? i /i,
  /^now let me /i, /^let me also /i, /^let me try /i,
  /^i need to /i, /^i should /i, /^let me check /i,
  /^let me look /i, /^let me search /i, /^let me query /i,
  /^let me find /i, /^now i'll /i, /^now i need /i,
];

// Patterns for lines that continue a thinking block (e.g., "and then...", "also...")
const CONTINUATION_PATTERNS = [
  /^(and |also |then |additionally |next |finally )/i,
  /^(this will |this should |this means |that way )/i,
  /^(so |because |since |in order to )/i,
  /^(after that |once |before )/i,
];

function createMessageId(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Lines with markdown formatting indicate actual response content
const MARKDOWN_LINE = /^(#{1,6} |[-*] |\d+\. |\|)/;

function splitThinkingAndResponse(text: string): { thinking: string; response: string } {
  // Don't split if text contains error indicators
  if (/\berror\b/i.test(text) || /\bfailed\b/i.test(text) || /\bsyntax error\b/i.test(text)) {
    return { thinking: "", response: text };
  }

  const lines = text.split("\n");
  const thinkingLines: string[] = [];
  const responseLines: string[] = [];
  let foundResponse = false;
  let inThinkingBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!foundResponse && trimmed && THINKING_PATTERNS.some((p) => p.test(trimmed))) {
      thinkingLines.push(line);
      inThinkingBlock = true;
    } else if (
      inThinkingBlock &&
      !foundResponse &&
      trimmed &&
      !MARKDOWN_LINE.test(trimmed) &&
      (CONTINUATION_PATTERNS.some((p) => p.test(trimmed)) || trimmed.length < 80)
    ) {
      // Short continuation lines within a thinking block
      thinkingLines.push(line);
    } else {
      if (trimmed) {
        foundResponse = true;
        inThinkingBlock = false;
      }
      responseLines.push(line);
    }
  }

  const response = responseLines.join("\n").trim();
  const thinking = thinkingLines.join("\n").trim();

  // If response is empty but we have thinking text, show everything as response
  if (!response && thinking) {
    return { thinking: "", response: text };
  }

  return { thinking, response };
}

function loadStoredMessages(): Message[] {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored).map((m: Message) => ({ ...m, id: m.id || createMessageId() }));
  } catch {
    return [];
  }
}

function loadStoredSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function ChatInterface({ onGraphUpdate, externalInput, onExternalInputConsumed }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCall[]>([]);
  const [streamingEntities, setStreamingEntities] = useState<ExtractedEntity[]>([]);
  const [streamingPreferences, setStreamingPreferences] = useState<DetectedPreference[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textBufferRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Hydrate from sessionStorage after mount to avoid SSR mismatch
  useEffect(() => {
    setMessages(loadStoredMessages());
    setSessionId(loadStoredSessionId());
    setHydrated(true);
  }, []);

  // Handle external input from graph "Ask about this" button
  useEffect(() => {
    if (externalInput && !loading) {
      sendMessage(externalInput);
      onExternalInputConsumed?.();
    }
  }, [externalInput]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, streamingToolCalls]);

  // Elapsed time counter during loading
  useEffect(() => {
    if (!loading) { setElapsedSeconds(0); return; }
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [loading]);

  // Persist chat history to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
      if (sessionId) sessionStorage.setItem(SESSION_KEY, sessionId);
    } catch { console.warn("Failed to persist chat history to sessionStorage"); }
  }, [messages, sessionId]);

  // Throttle streaming text updates to ~50ms to avoid excessive ReactMarkdown re-renders
  const flushTextBuffer = useCallback(() => {
    setStreamingContent(textBufferRef.current);
    flushTimerRef.current = null;
  }, []);

  const appendStreamingText = useCallback((text: string) => {
    textBufferRef.current += text;
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(flushTextBuffer, 50);
    }
  }, [flushTextBuffer]);

  function cancelRequest() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }

  function startNewConversation() {
    cancelRequest();
    setMessages([]);
    setSessionId(null);
    setStreamingContent("");
    setStreamingToolCalls([]);
    setStreamingEntities([]);
    setStreamingPreferences([]);
    setLoading(false);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
  }

  async function sendMessage(text?: string) {
    const messageText = text || input.trim();
    if (!messageText || loading) return;

    const userMessage: Message = { id: createMessageId(), role: "user", content: messageText };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setStreamingContent("");
    setStreamingToolCalls([]);
    setStreamingEntities([]);
    setStreamingPreferences([]);
    textBufferRef.current = "";

    const controller = new AbortController();
    abortControllerRef.current = controller;
    // Activity-based timeout: resets on each SSE event (120s idle)
    let timeout = setTimeout(() => controller.abort(), 120000);
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => controller.abort(), 120000);
    };

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageText,
          session_id: sessionId,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        const detail = errorData?.detail || `Backend error (${res.status})`;
        throw new Error(detail);
      }

      if (!res.body) {
        throw new Error("No response body for streaming");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let toolCalls: ToolCall[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventType) {
            resetTimeout();
            try {
              const data = JSON.parse(line.slice(6));
              switch (eventType) {
                case "session_id":
                  setSessionId(data.session_id);
                  break;

                case "tool_start":
                  toolCalls = [
                    ...toolCalls,
                    {
                      name: data.name,
                      inputs: data.inputs,
                      output_preview: "",
                      status: "running",
                    },
                  ];
                  setStreamingToolCalls([...toolCalls]);
                  break;

                case "tool_end": {
                  const endName = data.name;
                  let matched = false;
                  toolCalls = toolCalls.map((tc) => {
                    if (tc.name === endName && tc.status === "running" && !matched) {
                      matched = true;
                      return {
                        ...tc,
                        output_preview: data.output_preview || "",
                        status: "complete" as const,
                        graph_data: data.graph_data,
                      };
                    }
                    return tc;
                  });
                  setStreamingToolCalls([...toolCalls]);
                  if (data.graph_data?.results?.length && onGraphUpdate) {
                    onGraphUpdate(data.graph_data);
                  }
                  break;
                }

                case "text_delta":
                  fullText += data.text;
                  appendStreamingText(data.text);
                  break;

                case "entities_extracted":
                  if (data.entities?.length) {
                    setStreamingEntities((prev) => [...prev, ...data.entities]);
                  }
                  break;

                case "preferences_detected":
                  if (data.preferences?.length) {
                    setStreamingPreferences((prev) => [...prev, ...data.preferences]);
                  }
                  break;

                case "done":
                  // Flush any remaining buffered text
                  if (flushTimerRef.current) {
                    clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                  }
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: createMessageId(),
                      role: "assistant",
                      content: data.response || fullText,
                      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                    },
                  ]);
                  // Attach entities/preferences from the streaming state
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (!last || last.role !== "assistant") return prev;
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      ...last,
                      entities: streamingEntities.length > 0 ? [...streamingEntities] : undefined,
                      preferences: streamingPreferences.length > 0 ? [...streamingPreferences] : undefined,
                    };
                    return updated;
                  });
                  setStreamingContent("");
                  setStreamingToolCalls([]);
                  setStreamingEntities([]);
                  setStreamingPreferences([]);
                  textBufferRef.current = "";
                  break;

                case "error":
                  throw new Error(data.detail || "Streaming error");
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) {
                // JSON parse error — skip malformed event
              } else {
                throw parseErr;
              }
            }
            eventType = "";
          }
        }
      }
    } catch (err: unknown) {
      // Flush any partial streaming state
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      let errorMsg: string;
      if (err instanceof DOMException && err.name === "AbortError") {
        errorMsg = "Request timed out or was cancelled. Please try again.";
      } else if (err instanceof Error && err.message) {
        errorMsg = err.message;
      } else {
        errorMsg = "Cannot reach the backend. Is it running?";
      }
      setMessages((prev) => [
        ...prev,
        { id: createMessageId(), role: "assistant", content: `**Error:** ${errorMsg}`, retryInput: messageText },
      ]);
      setStreamingContent("");
      setStreamingToolCalls([]);
      setStreamingEntities([]);
      setStreamingPreferences([]);
      textBufferRef.current = "";
    } finally {
      clearTimeout(timeout);
      abortControllerRef.current = null;
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // Collect all prompts for suggested questions display
  const allPrompts = DEMO_SCENARIOS.flatMap((s) => s.prompts);

  return (
    <Flex direction="column" h="100%" className="glass" borderRadius="xl" overflow="hidden" m={[0, 2, 3]}>
      <HStack
        px={4}
        py={3}
        borderBottom="1px solid"
        borderColor="whiteAlpha.200"
        justifyContent="space-between"
        bg="whiteAlpha.50"
        backdropFilter="blur(8px)"
        zIndex={10}
      >
        <HStack gap={2}>
          <Box
            w={2}
            h={2}
            borderRadius="full"
            bgGradient="linear(135deg, #a78bfa, #22d3ee)"
            boxShadow="0 0 8px rgba(167,139,250,0.6)"
          />
          <Heading size="sm" color="white" letterSpacing="tight">
            Conversation
          </Heading>
        </HStack>
        {messages.length > 0 && (
          <Button
            size="xs"
            variant="ghost"
            color="gray.400"
            onClick={startNewConversation}
            _hover={{ bg: "whiteAlpha.100", color: "white" }}
          >
            <RotateCcw size={14} />
            New
          </Button>
        )}
      </HStack>

      {/* Demo scenario suggested questions */}
      {messages.length === 0 && !loading && (
        <Flex direction="column" flex={1} justify="center" px={4} py={6} className="msg-animate">
          <VStack gap={5}>
            <Box textAlign="center">
              <Text fontSize="3xl" fontWeight="bold" className="gradient-text" mb={2}>
                How can I help you?
              </Text>
              <Text fontSize="sm" color="gray.300">
                Explore the knowledge graph through natural conversation
              </Text>
            </Box>
            <HStack gap={1.5} color="gray.400" fontSize="xs" fontWeight="medium" letterSpacing="wider" textTransform="uppercase">
              <Sparkles size={12} />
              <Text>Try one of these</Text>
            </HStack>
            <Flex gap={2} flexWrap="wrap" justify="center" maxW="540px">
              {allPrompts.map((prompt, i) => (
                <Button
                  key={i}
                  className="glow-chip"
                  size="xs"
                  variant="plain"
                  rounded="full"
                  px={3.5}
                  fontWeight="normal"
                  whiteSpace="normal"
                  textAlign="start"
                  height="auto"
                  py={2}
                  maxW="340px"
                  color="gray.100"
                  onClick={() => sendMessage(prompt)}
                  title={prompt}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  {prompt}
                </Button>
              ))}
            </Flex>
            <Box h="1px" bg="whiteAlpha.200" my={2} />
            <VStack gap={2} w="full" maxW="500px">
              <Text fontSize="xs" color="gray.400" fontWeight="medium" textTransform="uppercase" letterSpacing="wider">
                Or ask your own question
              </Text>
              <Box w="full" className="glass-input" rounded="xl">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your question here..."
                  border="none"
                  _focus={{ boxShadow: "none", outline: "none" }}
                  _placeholder={{ color: "gray.600" }}
                  color="white"
                  resize="none"
                  rows={2}
                  fontSize="sm"
                  px={4}
                  py={3}
                  bg="transparent"
                />
                <HStack px={3} py={2} justify="flex-end" borderTop="1px solid" borderColor="whiteAlpha.100">
                  <IconButton
                    className="glow-button"
                    aria-label="Send"
                    onClick={() => sendMessage()}
                    disabled={!input.trim() || loading}
                    size="sm"
                    rounded="lg"
                  >
                    <Send size={14} />
                  </IconButton>
                </HStack>
              </Box>
            </VStack>
          </VStack>
        </Flex>
      )}

      {/* Messages */}
      <VStack flex={1} overflow="auto" px={4} py={4} gap={4} align="stretch"
        display={messages.length === 0 && !loading ? "none" : "flex"}
        css={{ "&::-webkit-scrollbar-track": { background: "transparent" } }}
      >
        {messages.map((msg) => (
          <Box key={msg.id} className="msg-animate">
            {/* Completed tool call cards */}
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <ToolCallTimeline toolCalls={msg.toolCalls} />
            )}
            <Flex gap={3} alignItems="flex-start" flexDirection={msg.role === "user" ? "row-reverse" : "row"}>
              <Circle
                size="8"
                bgGradient={msg.role === "user"
                  ? "linear(135deg, #a78bfa, #22d3ee)"
                  : "linear(135deg, #f472b6, #a78bfa)"}
                color="white"
                flexShrink={0}
                boxShadow={msg.role === "user"
                  ? "0 4px 14px rgba(167,139,250,0.45)"
                  : "0 4px 14px rgba(244,114,182,0.4)"}
                mt={0.5}
              >
                {msg.role === "user" ? <User size={14} /> : <Bot size={14} />}
              </Circle>
              <Box
                className={msg.role === "user" ? "glass-chat-bubble-user" : "glass-chat-bubble-ai"}
                px={4}
                py={3}
                borderRadius="xl"
                borderTopRightRadius={msg.role === "user" ? "sm" : "xl"}
                borderTopLeftRadius={msg.role === "ai" || msg.role === "assistant" ? "sm" : "xl"}
                flex={1}
                maxW="85%"
              >
                {msg.role === "assistant" ? (
                  <Box fontSize="sm" className="markdown-content" color="gray.50">
                    {(() => {
                      const { thinking, response } = splitThinkingAndResponse(msg.content);
                      return (
                        <>
                          {thinking && (
                            <Collapsible.Root>
                              <Collapsible.Trigger asChild>
                                <Button variant="ghost" size="xs" mb={1} color="gray.400" _hover={{ bg: "whiteAlpha.100", color: "gray.200" }}>
                                  <ChevronDown size={12} />
                                  Show reasoning
                                </Button>
                              </Collapsible.Trigger>
                              <Collapsible.Content>
                                <Box px={3} py={2} mb={2} bg="blackAlpha.400" borderRadius="md" fontSize="xs" color="gray.300" borderLeft="2px solid" borderColor="purple.400">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{thinking}</ReactMarkdown>
                                </Box>
                              </Collapsible.Content>
                            </Collapsible.Root>
                          )}
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{response || msg.content}</ReactMarkdown>
                        </>
                      );
                    })()}
                    {/* Extracted entities */}
                    {msg.entities && msg.entities.length > 0 && (
                      <HStack gap={1} mt={2} flexWrap="wrap">
                        {msg.entities.map((e, i) => (
                          <Badge key={i} size="xs" colorPalette="teal" variant="subtle">
                            {e.type}{e.subtype ? `/${e.subtype}` : ""}: {e.name}
                          </Badge>
                        ))}
                      </HStack>
                    )}
                    {/* Detected preferences */}
                    {msg.preferences && msg.preferences.length > 0 && (
                      <HStack gap={1} mt={1} flexWrap="wrap">
                        {msg.preferences.map((p, i) => (
                          <Badge key={i} size="xs" colorPalette="orange" variant="subtle">
                            {p.category}: {p.preference}
                          </Badge>
                        ))}
                      </HStack>
                    )}
                    {msg.retryInput && (
                      <Button
                        size="xs"
                        variant="outline"
                        mt={2}
                        onClick={() => {
                          setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                          sendMessage(msg.retryInput);
                        }}
                      >
                        <RotateCcw size={12} />
                        Retry
                      </Button>
                    )}
                  </Box>
                ) : (
                  <Text fontSize="sm" whiteSpace="pre-wrap" color="white" fontWeight="500">
                    {msg.content}
                  </Text>
                )}
              </Box>
            </Flex>
          </Box>
        ))}

        {/* Streaming in progress */}
        {loading && (
          <Box className="msg-animate">
            {/* Real-time tool call timeline */}
            {streamingToolCalls.length > 0 && (
              <ToolCallTimeline toolCalls={streamingToolCalls} />
            )}
            {/* Streaming text */}
            {streamingContent ? (
              <Flex gap={3} alignItems="flex-start">
                <Circle size="8" bgGradient="linear(135deg, #f472b6, #a78bfa)" color="white" flexShrink={0} mt={0.5} boxShadow="0 4px 14px rgba(244,114,182,0.4)">
                  <Bot size={14} />
                </Circle>
                <Box className="glass-chat-bubble-ai" px={4} py={3} borderRadius="xl" borderTopLeftRadius="sm" flex={1}>
                  <Box fontSize="sm" className="markdown-content" color="gray.100">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {streamingContent}
                    </ReactMarkdown>
                  </Box>
                </Box>
              </Flex>
            ) : (
              /* Loading skeleton when waiting for first content */
              <Flex gap={3} alignItems="flex-start">
                <Circle size="8" bgGradient="linear(135deg, #f472b6, #a78bfa)" color="white" flexShrink={0} mt={0.5} animation="pulse-ring 1.6s ease-out infinite">
                  <Bot size={14} />
                </Circle>
                <Box className="glass-chat-bubble-ai" px={4} py={3} borderRadius="xl" borderTopLeftRadius="sm" flex={1}>
                  {streamingToolCalls.length === 0 ? (
                    <VStack align="stretch" gap={2}>
                      <HStack gap={2}>
                        <Spinner size="xs" color="purple.300" />
                        <Text fontSize="sm" className="shimmer-text" fontWeight="medium">Thinking...</Text>
                        {elapsedSeconds > 3 && (
                          <Text fontSize="xs" color="gray.500">{elapsedSeconds}s</Text>
                        )}
                      </HStack>
                      <Skeleton height="3" width="80%" startColor="whiteAlpha.100" endColor="whiteAlpha.300" borderRadius="md" />
                      <Skeleton height="3" width="60%" startColor="whiteAlpha.100" endColor="whiteAlpha.300" borderRadius="md" />
                    </VStack>
                  ) : (
                    <HStack gap={2}>
                      <Spinner size="xs" color="cyan.300" />
                      <Text fontSize="sm" color="gray.300">
                        Running tool {streamingToolCalls.filter(tc => tc.status === "complete").length + 1}
                        {" of "}
                        {streamingToolCalls.length}...
                      </Text>
                      {elapsedSeconds > 3 && (
                        <Text fontSize="xs" color="gray.500">{elapsedSeconds}s</Text>
                      )}
                    </HStack>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    mt={2}
                    onClick={cancelRequest}
                    color="gray.400"
                    _hover={{ bg: "whiteAlpha.100", color: "white" }}
                  >
                    Cancel
                  </Button>
                </Box>
              </Flex>
            )}
          </Box>
        )}
        <div ref={messagesEndRef} />
      </VStack>

      {/* Input area — Chakra UI Pro inspired bordered container */}
      {messages.length > 0 && (
        <Box px={4} py={3} borderTop="1px solid" borderColor="whiteAlpha.200" bg="whiteAlpha.50" backdropFilter="blur(8px)" zIndex={10}>
          <Box className="glass-input" rounded="xl">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your agent memory data..."
              border="none"
              _focus={{ boxShadow: "none", outline: "none" }}
              _placeholder={{ color: "gray.600" }}
              color="white"
              resize="none"
              rows={2}
              fontSize="sm"
              px={4}
              py={3}
              bg="transparent"
            />
            <HStack px={3} py={2} justify="space-between" borderTop="1px solid" borderColor="whiteAlpha.100">
              <Text fontSize="xs" color="gray.500" display={{ base: "none", sm: "block" }}>
                <Text as="span" color="gray.400" fontWeight="medium">Enter</Text> to send
                {" · "}
                <Text as="span" color="gray.400" fontWeight="medium">Shift + Enter</Text> new line
              </Text>
              <IconButton
                className="glow-button"
                aria-label="Send"
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                size="sm"
                rounded="lg"
              >
                <Send size={14} />
              </IconButton>
            </HStack>
          </Box>
        </Box>
      )}
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// Tool call timeline component
// ---------------------------------------------------------------------------

function ToolCallTimeline({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <Timeline.Root size="sm" mb={2}>
      {toolCalls.map((tc, j) => (
        <Timeline.Item key={`${tc.name}-${j}`}>
          <Timeline.Connector>
            <Timeline.Separator />
            <Timeline.Indicator
              bg={tc.status === "running" ? "purple.500" : "green.400"}
              color="white"
              boxShadow={tc.status === "running" ? "0 0 12px rgba(167,139,250,0.6)" : "0 0 10px rgba(52,211,153,0.5)"}
            >
              {tc.status === "running" ? (
                <Spinner size="xs" color="white" />
              ) : (
                <Check size={10} />
              )}
            </Timeline.Indicator>
          </Timeline.Connector>
          <Timeline.Content pb={2}>
            <Collapsible.Root>
              <HStack gap={2}>
                <Badge colorPalette="purple" size="sm" bg="rgba(167,139,250,0.18)" color="purple.200" border="1px solid" borderColor="purple.700">
                  <Wrench size={10} />
                  {tc.name}
                </Badge>
                {tc.status === "running" && (
                  <Text fontSize="xs" color="gray.400" className="shimmer-text">running...</Text>
                )}
                {tc.output_preview && (
                  <Collapsible.Trigger asChild>
                    <Button variant="ghost" size="xs" px={1} color="gray.400" _hover={{ bg: "whiteAlpha.100", color: "white" }}>
                      <ChevronDown size={12} />
                    </Button>
                  </Collapsible.Trigger>
                )}
              </HStack>
              {tc.output_preview && (
                <Collapsible.Content>
                  <Box
                    mt={1}
                    px={2.5}
                    py={1.5}
                    bg="blackAlpha.500"
                    border="1px solid"
                    borderColor="whiteAlpha.100"
                    borderRadius="md"
                    fontSize="xs"
                    fontFamily="mono"
                    maxH="140px"
                    overflow="auto"
                  >
                    <Text color="purple.200" mb={1} fontWeight="medium">
                      Inputs: {JSON.stringify(tc.inputs).slice(0, 120)}
                    </Text>
                    <Text color="gray.400">
                      {tc.output_preview.slice(0, 300)}
                      {tc.output_preview.length > 300 && "..."}
                    </Text>
                  </Box>
                </Collapsible.Content>
              )}
            </Collapsible.Root>
          </Timeline.Content>
        </Timeline.Item>
      ))}
    </Timeline.Root>
  );
}
