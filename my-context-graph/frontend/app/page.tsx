"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Box, Flex, Heading, Text, Tabs, IconButton, HStack, Spinner } from "@chakra-ui/react";
import { MessageSquare, Network, FileText } from "lucide-react";
import dynamic from "next/dynamic";
import { ChatInterface } from "@/components/ChatInterface";
const ContextGraphView = dynamic(
  () => import("@/components/ContextGraphView").then((mod) => mod.ContextGraphView),
  {
    ssr: false,
    loading: () => (
      <Flex align="center" justify="center" h="100%" color="gray.400">
        <Spinner size="lg" />
      </Flex>
    ),
  }
);
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DecisionTracePanel } from "@/components/DecisionTracePanel";
import { DocumentBrowser } from "@/components/DocumentBrowser";
import { DOMAIN, API_BASE } from "@/lib/config";
import type { GraphData } from "@/lib/config";

type PanelId = "chat" | "graph" | "details";

function ResizeHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      function onMouseMove(ev: MouseEvent) {
        onDrag(ev.clientX - startX);
      }
      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [onDrag],
  );

  return (
    <Box
      w="4px"
      cursor="col-resize"
      bg="transparent"
      _hover={{ bg: "purple.400", boxShadow: "0 0 12px rgba(167,139,250,0.6)" }}
      transition="all 0.2s"
      flexShrink={0}
      display={{ base: "none", lg: "block" }}
      onMouseDown={handleMouseDown}
    />
  );
}

export default function Home() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [activePanel, setActivePanel] = useState<PanelId>("chat");
  const [backendStatus, setBackendStatus] = useState<"ok" | "degraded" | "offline">("offline");
  const [leftWidth, setLeftWidth] = useState(400);
  const [rightWidth, setRightWidth] = useState(350);
  const leftBaseRef = useRef(400);
  const rightBaseRef = useRef(350);

  const [askAboutInput, setAskAboutInput] = useState<string | null>(null);

  const handleGraphUpdate = useCallback((data: GraphData) => {
    setGraphData(data);
  }, []);

  const handleAskAbout = useCallback((entityName: string) => {
    setAskAboutInput(`Tell me about ${entityName}`);
    setActivePanel("chat");
  }, []);

  // Poll backend health every 60 seconds with retry on initial load
  useEffect(() => {
    async function checkHealth(retries = 3, delay = 1000) {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const res = await fetch(`${API_BASE.replace("/api", "")}/health`, {
            signal: AbortSignal.timeout(5000),
          });
          const data = await res.json();
          setBackendStatus(data.status === "ok" ? "ok" : "degraded");
          return;
        } catch {
          if (attempt < retries - 1) {
            await new Promise(r => setTimeout(r, delay * (attempt + 1)));
          }
        }
      }
      setBackendStatus("offline");
    }
    checkHealth();
    const interval = setInterval(() => checkHealth(1), 60000);
    return () => clearInterval(interval);
  }, []);

  const handleLeftDrag = useCallback((delta: number) => {
    setLeftWidth(Math.min(600, Math.max(280, leftBaseRef.current + delta)));
  }, []);

  const handleRightDrag = useCallback((delta: number) => {
    setRightWidth(Math.min(600, Math.max(280, rightBaseRef.current - delta)));
  }, []);

  // Update base refs when drag ends (width stabilizes)
  useEffect(() => {
    leftBaseRef.current = leftWidth;
  }, [leftWidth]);
  useEffect(() => {
    rightBaseRef.current = rightWidth;
  }, [rightWidth]);

  return (
    <Flex direction="column" h="100dvh" bg="transparent">
      {/* Header */}
      <Flex
        className="glass"
        borderRadius="0"
        borderTop="none"
        borderLeft="none"
        borderRight="none"
        px={6}
        py={4}
        justify="space-between"
        align="center"
        zIndex={20}
      >
        <HStack gap={3}>
          <Box
            w={9}
            h={9}
            borderRadius="lg"
            bgGradient="linear(135deg, #a78bfa, #22d3ee)"
            display="flex"
            alignItems="center"
            justifyContent="center"
            fontSize="lg"
            boxShadow="0 4px 16px rgba(167, 139, 250, 0.4)"
          >
            🧠
          </Box>
          <Box>
            <Heading size="md" className="gradient-text">
              {DOMAIN.name} Context Graph
            </Heading>
            <Text fontSize="xs" color="gray.400" fontWeight="medium" mt={0.5} letterSpacing="wide">
              {DOMAIN.tagline}
            </Text>
          </Box>
        </HStack>
        <HStack
          gap={2}
          bg="rgba(255,255,255,0.64)"
          px={3}
          py={1.5}
          borderRadius="full"
          border="1px solid"
          borderColor="blackAlpha.200"
        >
          <Box
            className="status-dot"
            w={2}
            h={2}
            borderRadius="full"
            bg={
              backendStatus === "ok"
                ? "#34d399"
                : backendStatus === "degraded"
                  ? "#fbbf24"
                  : "#f87171"
            }
            title={
              backendStatus === "ok"
                ? "Backend connected"
                : backendStatus === "degraded"
                  ? "Backend connected (Neo4j unavailable)"
                  : "Backend offline"
            }
          />
          <Text fontSize="xs" color="gray.700" fontWeight="medium" letterSpacing="wide">
            {backendStatus === "ok"
              ? "CONNECTED"
              : backendStatus === "degraded"
                ? "DEGRADED"
                : "OFFLINE"}
          </Text>
        </HStack>
      </Flex>

      {/* Main content - 3 panel layout */}
      <Flex as="main" flex={1} overflow="hidden">
        {/* Left panel: Chat */}
        <Box
          as="section"
          aria-label="Chat"
          w={{ base: "100%", lg: `${leftWidth}px` }}
          minW={{ lg: "280px" }}
          overflow="auto"
          flexShrink={0}
          display={{ base: activePanel === "chat" ? "block" : "none", lg: "block" }}
        >
          <ChatInterface
              onGraphUpdate={handleGraphUpdate}
              externalInput={askAboutInput}
              onExternalInputConsumed={() => setAskAboutInput(null)}
            />
        </Box>

        <ResizeHandle onDrag={handleLeftDrag} />

        {/* Center panel: Graph visualization */}
        <Box
          as="section"
          aria-label="Graph visualization"
          flex={1}
          bg="transparent"
          p={2}
          display={{ base: activePanel === "graph" ? "block" : "none", lg: "block" }}
        >
          <Box className="glass" h="100%" borderRadius="xl" overflow="hidden" boxShadow="0 8px 32px rgba(31, 38, 135, 0.1)">
            <ErrorBoundary fallbackMessage="Graph visualization error">
              <ContextGraphView externalGraphData={graphData} onAskAbout={handleAskAbout} />
            </ErrorBoundary>
          </Box>
        </Box>

        <ResizeHandle onDrag={handleRightDrag} />

        {/* Right panel: Decision traces + Documents */}
        <Box
          as="aside"
          aria-label="Details"
          w={{ base: "100%", lg: `${rightWidth}px` }}
          minW={{ lg: "280px" }}
          overflow="hidden"
          flexShrink={0}
          display={{ base: activePanel === "details" ? "block" : "none", lg: "block" }}
          p={2}
        >
          <Box className="glass" h="100%" borderRadius="xl" overflow="hidden">
            <Tabs.Root defaultValue="traces" size="sm" h="100%" display="flex" flexDirection="column">
              <Tabs.List
                borderBottom="1px solid"
                borderColor="blackAlpha.200"
                bg="rgba(255,255,255,0.6)"
                backdropFilter="blur(8px)"
                px={2}
                gap={1}
              >
                <Tabs.Trigger
                  value="traces"
                  color="gray.400"
                  px={3}
                  py={2}
                  fontSize="xs"
                  fontWeight="semibold"
                  letterSpacing="wide"
                  textTransform="uppercase"
                  position="relative"
                  _selected={{
                    color: "gray.900",
                    bg: "white",
                    borderRadius: "md",
                    boxShadow: "inset 0 -2px 0 0 #a78bfa, 0 0 16px rgba(167,139,250,0.2)",
                  }}
                  _hover={{ color: "gray.900", bg: "whiteAlpha.700" }}
                  transition="all 0.2s"
                >
                  Traces
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="documents"
                  color="gray.400"
                  px={3}
                  py={2}
                  fontSize="xs"
                  fontWeight="semibold"
                  letterSpacing="wide"
                  textTransform="uppercase"
                  position="relative"
                  _selected={{
                    color: "gray.900",
                    bg: "white",
                    borderRadius: "md",
                    boxShadow: "inset 0 -2px 0 0 #22d3ee, 0 0 16px rgba(34,211,238,0.2)",
                  }}
                  _hover={{ color: "gray.900", bg: "whiteAlpha.700" }}
                  transition="all 0.2s"
                >
                  Documents
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content
                value="traces"
                p={0}
                flex={1}
                overflow="auto"
                css={{ "&::-webkit-scrollbar-track": { background: "transparent" } }}
              >
                <DecisionTracePanel />
              </Tabs.Content>
              <Tabs.Content
                value="documents"
                p={0}
                flex={1}
                overflow="auto"
                css={{ "&::-webkit-scrollbar-track": { background: "transparent" } }}
              >
                <DocumentBrowser />
              </Tabs.Content>
            </Tabs.Root>
          </Box>
        </Box>
      </Flex>

      {/* Mobile bottom tab bar — hidden on desktop */}
      <HStack
        display={{ base: "flex", lg: "none" }}
        justify="space-around"
        py={2}
        className="glass"
        borderRadius="0"
      >
        <IconButton
          aria-label="Chat panel"
          variant={activePanel === "chat" ? "solid" : "ghost"}
          size="sm"
          onClick={() => setActivePanel("chat")}
        >
          <MessageSquare size={18} />
        </IconButton>
        <IconButton
          aria-label="Graph panel"
          variant={activePanel === "graph" ? "solid" : "ghost"}
          size="sm"
          onClick={() => setActivePanel("graph")}
        >
          <Network size={18} />
        </IconButton>
        <IconButton
          aria-label="Details panel"
          variant={activePanel === "details" ? "solid" : "ghost"}
          size="sm"
          onClick={() => setActivePanel("details")}
        >
          <FileText size={18} />
        </IconButton>
      </HStack>
    </Flex>
  );
}
