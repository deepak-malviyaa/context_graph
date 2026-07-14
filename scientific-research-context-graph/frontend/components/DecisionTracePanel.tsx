"use client";

import { useEffect, useState } from "react";
import { Box, Heading, Text, VStack, HStack, Badge, Flex, Circle, IconButton } from "@chakra-ui/react";
import { GitBranch, Brain, Wrench, Eye, Orbit, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { API_BASE } from "@/lib/config";

interface TraceStep {
  step_number: number;
  thought: string;
  action: string;
  observation?: string;
}

interface DecisionTrace {
  id: string;
  task: string;
  steps: TraceStep[];
  outcome: string;
}

interface TraceQuestionLink {
  question: string;
  askedAt: string;
  queryText?: string;
  toolName?: string;
}

interface DecisionTracePanelProps {
  isCollapsed?: boolean;
  onTraceCountChange?: (count: number) => void;
}

export function DecisionTracePanel({ isCollapsed = false, onTraceCountChange }: DecisionTracePanelProps) {
  const [traces, setTraces] = useState<DecisionTrace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<DecisionTrace | null>(null);
  const [traceQuestionLinks, setTraceQuestionLinks] = useState<Record<string, TraceQuestionLink[]>>({});
  const [pendingQuestion, setPendingQuestion] = useState<TraceQuestionLink | null>(null);
  const [orbitIndex, setOrbitIndex] = useState(0);

  useEffect(() => {
    void loadTraces();
  }, []);

  useEffect(() => {
    onTraceCountChange?.(traces.length);
  }, [onTraceCountChange, traces.length]);

  useEffect(() => {
    if (isCollapsed || traces.length <= 1) return;

    const timer = window.setInterval(() => {
      setOrbitIndex((current) => (current + 1) % traces.length);
    }, 3200);

    return () => window.clearInterval(timer);
  }, [isCollapsed, traces.length]);

  useEffect(() => {
    function handleQuestion(event: Event) {
      const customEvent = event as CustomEvent<TraceQuestionLink>;
      setPendingQuestion(customEvent.detail);
      void loadTraces(customEvent.detail);
    }

    function handleQuery(event: Event) {
      const customEvent = event as CustomEvent<TraceQuestionLink>;
      setPendingQuestion((current) => current && current.askedAt === customEvent.detail.askedAt
        ? { ...current, queryText: customEvent.detail.queryText, toolName: customEvent.detail.toolName }
        : current);
    }

    window.addEventListener("ccg:trace-question", handleQuestion as EventListener);
    window.addEventListener("ccg:trace-query", handleQuery as EventListener);

    return () => {
      window.removeEventListener("ccg:trace-question", handleQuestion as EventListener);
      window.removeEventListener("ccg:trace-query", handleQuery as EventListener);
    };
  }, [traces]);

  async function loadTraces(trigger?: TraceQuestionLink) {
    try {
      const previousIds = new Set(traces.map((trace) => trace.id));
      const res = await fetch(`${API_BASE}/traces`, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      if (!data.traces) return;

      const normalized = data.traces.map((t: Record<string, unknown>) => ({
        id: (t.id as string) || "",
        task: (t.task as string) || "",
        steps: ((t.steps as TraceStep[]) || []).filter((s) => s && s.thought),
        outcome: (t.outcome as string) || "",
      }));

      setTraces(normalized);
      setSelectedTrace((current) => {
        if (!normalized.length) return null;
        return normalized.find((trace: DecisionTrace) => trace.id === current?.id) || normalized[0];
      });

      if (!trigger) return;

      const newIds = normalized
        .filter((trace: DecisionTrace) => !previousIds.has(trace.id))
        .map((trace: DecisionTrace) => trace.id);
      const candidateIds = newIds.length > 0
        ? newIds
        : normalized
          .slice()
          .sort((a: DecisionTrace, b: DecisionTrace) => b.steps.length - a.steps.length)
          .slice(0, Math.min(2, normalized.length))
          .map((trace: DecisionTrace) => trace.id);

      if (candidateIds.length > 0) {
        setTraceQuestionLinks((current) => {
          const next = { ...current };
          for (const traceId of candidateIds) {
            const existing = next[traceId] || [];
            next[traceId] = [trigger, ...existing.filter((item) => item.askedAt !== trigger.askedAt)].slice(0, 5);
          }
          return next;
        });
      }

      setPendingQuestion(null);
    } catch {
      // Backend may not be running yet
    }
  }

  const activeOrbitTrace = traces[orbitIndex] || traces[0] || null;

  if (isCollapsed) {
    return null;
  }

  return (
    <Flex direction="column" h="100%">
      <Box px={4} py={3} borderBottom="1px solid" borderColor="gray.200">
        <Heading size="sm" className="panel-heading">
          <HStack>
            <GitBranch size={16} />
            <span>Decision Traces</span>
          </HStack>
        </Heading>
        <Text fontSize="xs" color="gray.500">
          Reasoning provenance & causal chains
        </Text>
      </Box>

      <VStack flex={1} overflow="auto" px={4} py={2} gap={2} align="stretch">
        {traces.length === 0 ? (
          <Box py={8} px={4}>
            <Flex justify="center" mb={3}>
              <GitBranch size={32} color="#A0AEC0" />
            </Flex>
            <Text fontSize="sm" color="gray.500" textAlign="center">
              No decision traces yet
            </Text>
            <Text fontSize="xs" color="gray.400" textAlign="center" mt={2} lineHeight="tall">
              Decision traces capture multi-step reasoning chains - the thoughts,
              actions, and observations an agent uses to reach a conclusion.
            </Text>
            <Box mt={3} textAlign="center">
              <Badge variant="outline" fontSize="xs" fontFamily="mono" px={2}>
                make seed
              </Badge>
            </Box>
          </Box>
        ) : (
          <>
            <Box className="trace-hero semi-glass-pane">
              <Flex justify="space-between" align="center" gap={3}>
                <Box>
                  <Text className="trace-hero-kicker">Live reasoning orbit</Text>
                  <Text fontSize="sm" color="whiteAlpha.800">
                    Exact questions and query fragments can be pinned to each trace as you chat.
                  </Text>
                </Box>
                <HStack gap={2}>
                  <IconButton
                    aria-label="Previous trace"
                    size="xs"
                    variant="ghost"
                    onClick={() => setOrbitIndex((current) => (current - 1 + traces.length) % traces.length)}
                  >
                    <ChevronLeft size={14} />
                  </IconButton>
                  <IconButton
                    aria-label="Next trace"
                    size="xs"
                    variant="ghost"
                    onClick={() => setOrbitIndex((current) => (current + 1) % traces.length)}
                  >
                    <ChevronRight size={14} />
                  </IconButton>
                </HStack>
              </Flex>

              <Flex className="trace-orbit-shell" align="center" justify="center" mt={4} mb={4}>
                <Box className="trace-orbit-ring trace-orbit-ring-outer" />
                <Box className="trace-orbit-ring trace-orbit-ring-mid" />
                <Box className="trace-orbit-ring trace-orbit-ring-inner" />
                <Circle size="132px" className="trace-orbit-core">
                  <VStack gap={1}>
                    <Orbit size={20} />
                    <Text fontSize="xs" textAlign="center" fontWeight="semibold">
                      {activeOrbitTrace?.steps.length || 0} step{activeOrbitTrace?.steps.length === 1 ? "" : "s"}
                    </Text>
                    <Text fontSize="10px" textAlign="center" color="whiteAlpha.700">
                      {traces.length} total traces
                    </Text>
                  </VStack>
                </Circle>
                {traces.slice(0, 6).map((trace, index, orbitTraces) => {
                  const angle = (Math.PI * 2 * index) / Math.max(orbitTraces.length, 1) - Math.PI / 2;
                  const radius = 108;
                  const x = Math.cos(angle) * radius;
                  const y = Math.sin(angle) * radius;
                  const isActive = activeOrbitTrace?.id === trace.id;

                  return (
                    <button
                      key={trace.id}
                      type="button"
                      className={`trace-orbit-node${isActive ? " is-active" : ""}`}
                      style={{ transform: `translate(${x}px, ${y}px)` }}
                      onClick={() => {
                        setSelectedTrace(trace);
                        setOrbitIndex(index);
                      }}
                    >
                      <Sparkles size={12} />
                      <span>{trace.steps.length}</span>
                    </button>
                  );
                })}
              </Flex>

              {activeOrbitTrace && (
                <Box className="trace-hero-card semi-glass-pane">
                  <Text fontSize="sm" fontWeight="semibold" lineClamp={2}>
                    {activeOrbitTrace.task}
                  </Text>
                  <HStack mt={2} gap={2} flexWrap="wrap">
                    <Badge size="sm" variant="outline">
                      <Brain size={10} />
                      {activeOrbitTrace.steps.length} steps
                    </Badge>
                    {traceQuestionLinks[activeOrbitTrace.id]?.[0]?.question && (
                      <Badge size="sm" colorPalette="cyan">
                        Linked question
                      </Badge>
                    )}
                    {activeOrbitTrace.outcome && (
                      <Badge size="sm" colorPalette="green">
                        Resolved
                      </Badge>
                    )}
                  </HStack>
                </Box>
              )}
            </Box>

            {traces.map((trace) => {
              const linkedQuestions = traceQuestionLinks[trace.id] || [];

              return (
                <Box
                  key={trace.id}
                  className={`list-card trace-card${selectedTrace?.id === trace.id ? " active" : ""}`}
                  p={3}
                  cursor="pointer"
                  onClick={() => setSelectedTrace(trace)}
                >
                  <Flex justify="space-between" align="flex-start" gap={3}>
                    <HStack align="flex-start" gap={3}>
                      <Circle size="48px" className="trace-step-badge">
                        <VStack gap={0}>
                          <Text fontSize="xs" fontWeight="bold">{trace.steps.length}</Text>
                          <Text fontSize="9px">steps</Text>
                        </VStack>
                      </Circle>
                      <Box>
                        <Text fontSize="sm" fontWeight="medium" lineClamp={2}>
                          {trace.task}
                        </Text>
                        <HStack mt={2} gap={2} flexWrap="wrap">
                          <Badge size="sm" variant="outline">
                            <Brain size={10} />
                            {trace.steps.length} steps
                          </Badge>
                          {linkedQuestions.length > 0 && (
                            <Badge size="sm" colorPalette="cyan">
                              {linkedQuestions.length} linked prompt{linkedQuestions.length === 1 ? "" : "s"}
                            </Badge>
                          )}
                          {trace.outcome && (
                            <Badge size="sm" colorPalette="green">
                              Resolved
                            </Badge>
                          )}
                        </HStack>
                      </Box>
                    </HStack>
                  </Flex>

                  {linkedQuestions[0] && (
                    <Box mt={3} className="trace-question-chip semi-glass-pane">
                      <Text fontSize="10px" textTransform="uppercase" letterSpacing="0.12em" color="cyan.200">
                        Related question
                      </Text>
                      <Text fontSize="xs" color="whiteAlpha.900" mt={1}>
                        {linkedQuestions[0].question}
                      </Text>
                      {linkedQuestions[0].queryText && (
                        <Text fontSize="11px" color="whiteAlpha.700" mt={1}>
                          {linkedQuestions[0].toolName}: {linkedQuestions[0].queryText}
                        </Text>
                      )}
                    </Box>
                  )}
                </Box>
              );
            })}
          </>
        )}
      </VStack>

      {selectedTrace && (
        <Box borderTop="1px solid" borderColor="gray.200" px={4} py={3} maxH="50%" overflow="auto" className="semi-glass-pane">
          <Text fontSize="sm" fontWeight="bold" mb={2}>
            {selectedTrace.task}
          </Text>
          {(traceQuestionLinks[selectedTrace.id]?.length || pendingQuestion) && (
            <Box mb={3} className="trace-linked-questions semi-glass-pane">
              <HStack mb={2}>
                <Sparkles size={12} />
                <Text fontSize="xs" fontWeight="semibold">
                  Linked chat prompts
                </Text>
              </HStack>
              <VStack gap={2} align="stretch">
                {[...(traceQuestionLinks[selectedTrace.id] || []), ...(pendingQuestion ? [pendingQuestion] : [])]
                  .filter((item, index, items) => items.findIndex((candidate) => candidate.askedAt === item.askedAt) === index)
                  .slice(0, 3)
                  .map((item) => (
                    <Box key={item.askedAt} className="trace-question-chip compact semi-glass-pane">
                      <Text fontSize="xs" color="whiteAlpha.900">{item.question}</Text>
                      {item.queryText && (
                        <Text fontSize="11px" color="whiteAlpha.700" mt={1}>
                          {item.toolName}: {item.queryText}
                        </Text>
                      )}
                    </Box>
                  ))}
              </VStack>
            </Box>
          )}
          <VStack gap={3} align="stretch">
            {selectedTrace.steps.map((step, i) => (
              <Box key={i} pl={3} borderLeft="2px solid" borderColor="blue.200">
                <HStack>
                  <Brain size={12} />
                  <Text fontSize="xs" color="whiteAlpha.900">
                    {step.thought}
                  </Text>
                </HStack>
                <HStack mt={1}>
                  <Wrench size={12} />
                  <Text fontSize="xs" fontFamily="mono" color="whiteAlpha.850">
                    {step.action}
                  </Text>
                </HStack>
                {step.observation && (
                  <HStack mt={1}>
                    <Eye size={12} />
                    <Text fontSize="xs" color="green.200">
                      {step.observation}
                    </Text>
                  </HStack>
                )}
              </Box>
            ))}
          </VStack>
          {selectedTrace.outcome && (
            <Box mt={3} p={2} borderRadius="md" className="trace-outcome-card">
              <Text fontSize="xs" fontWeight="bold" color="whiteAlpha.950">
                Outcome:
              </Text>
              <Text fontSize="xs" color="whiteAlpha.900">{selectedTrace.outcome}</Text>
            </Box>
          )}
        </Box>
      )}
    </Flex>
  );
}
