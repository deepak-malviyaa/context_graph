"use client";

import { useState, useEffect } from "react";
import { Box, Heading, Text, VStack, HStack, Badge, Flex } from "@chakra-ui/react";
import { GitBranch, Brain, Wrench, Eye } from "lucide-react";
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

export function DecisionTracePanel() {
  const [traces, setTraces] = useState<DecisionTrace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<DecisionTrace | null>(null);

  useEffect(() => {
    loadTraces();
  }, []);

  async function loadTraces() {
    try {
      const res = await fetch(`${API_BASE}/traces`, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      if (data.traces) {
        setTraces(
          data.traces.map((t: Record<string, unknown>) => ({
            id: (t.id as string) || "",
            task: (t.task as string) || "",
            steps: ((t.steps as TraceStep[]) || []).filter(
              (s) => s && s.thought
            ),
            outcome: (t.outcome as string) || "",
          }))
        );
      }
    } catch {
      // Backend may not be running yet
    }
  }

  return (
    <Flex direction="column" h="100%">
      <Box
        px={4}
        py={3}
        borderBottom="1px solid"
        borderColor="whiteAlpha.200"
        bg="whiteAlpha.50"
        backdropFilter="blur(8px)"
        zIndex={10}
      >
        <Heading size="sm" color="white" letterSpacing="tight">
          <HStack gap={2}>
            <GitBranch size={16} color="#a78bfa" />
            <span>Decision Traces</span>
          </HStack>
        </Heading>
        <Text fontSize="xs" color="gray.400" mt={1} letterSpacing="wide">
          Reasoning provenance & causal chains
        </Text>
      </Box>

      <VStack flex={1} overflow="auto" px={4} py={3} gap={2.5} align="stretch">
        {traces.length === 0 ? (
          <Box py={8} px={4} className="msg-animate">
            <Flex justify="center" mb={3}>
              <GitBranch size={32} color="#a78bfa" />
            </Flex>
            <Text fontSize="sm" color="gray.300" textAlign="center" fontWeight="medium">
              No decision traces yet
            </Text>
            <Text fontSize="xs" color="gray.500" textAlign="center" mt={2} lineHeight="tall">
              Decision traces capture multi-step reasoning chains — the thoughts,
              actions, and observations an agent uses to reach a conclusion.
            </Text>
            <Box mt={3} textAlign="center">
              <Badge variant="outline" fontSize="xs" fontFamily="mono" px={2} color="cyan.300" borderColor="cyan.700">
                make seed
              </Badge>
            </Box>
          </Box>
        ) : (
          traces.map((trace) => (
            <Box
              key={trace.id}
              p={3}
              borderRadius="lg"
              border="1px solid"
              borderColor={
                selectedTrace?.id === trace.id ? "purple.400" : "whiteAlpha.150"
              }
              bg={selectedTrace?.id === trace.id ? "whiteAlpha.100" : "whiteAlpha.50"}
              backdropFilter="blur(10px)"
              cursor="pointer"
              onClick={() => setSelectedTrace(trace)}
              _hover={{
                borderColor: "purple.300",
                bg: "whiteAlpha.100",
                transform: "translateY(-1px)",
                boxShadow: "0 4px 16px rgba(167,139,250,0.15)",
              }}
              transition="all 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
              boxShadow={selectedTrace?.id === trace.id ? "0 4px 16px rgba(167,139,250,0.2)" : "none"}
            >
            >
              <Text fontSize="sm" fontWeight="medium" lineClamp={2} color="gray.100">
                {trace.task}
              </Text>
              <HStack mt={2} gap={2}>
                <Badge size="sm" variant="outline" color="purple.200" borderColor="purple.700">
                  <Brain size={10} />
                  {trace.steps.length} steps
                </Badge>
                {trace.outcome && (
                  <Badge size="sm" bg="rgba(52,211,153,0.15)" color="green.300" border="1px solid" borderColor="green.700">
                    Resolved
                  </Badge>
                )}
              </HStack>
            </Box>
          ))
        )}
      </VStack>

      {/* Selected trace detail */}
      {selectedTrace && (
        <Box
          borderTop="1px solid"
          borderColor="whiteAlpha.200"
          bg="blackAlpha.300"
          backdropFilter="blur(5px)"
          px={4}
          py={3}
          maxH="50%"
          overflow="auto"
          className="msg-animate"
        >
          <Text fontSize="sm" fontWeight="bold" mb={3} color="white">
            {selectedTrace.task}
          </Text>
          <VStack gap={3} align="stretch">
            {selectedTrace.steps.map((step, i) => (
              <Box key={i} pl={3} borderLeft="2px solid" borderColor="purple.400">
                <HStack gap={2}>
                  <Brain size={12} color="#a78bfa" />
                  <Text fontSize="xs" color="gray.300">
                    {step.thought}
                  </Text>
                </HStack>
                <HStack mt={1} gap={2}>
                  <Wrench size={12} color="#22d3ee" />
                  <Text fontSize="xs" fontFamily="mono" color="cyan.300">
                    {step.action}
                  </Text>
                </HStack>
                {step.observation && (
                  <HStack mt={1} gap={2}>
                    <Eye size={12} color="#34d399" />
                    <Text fontSize="xs" color="green.300">
                      {step.observation}
                    </Text>
                  </HStack>
                )}
              </Box>
            ))}
          </VStack>
          {selectedTrace.outcome && (
            <Box mt={3} p={3} bg="rgba(52,211,153,0.1)" border="1px solid" borderColor="green.700" borderRadius="md">
              <Text fontSize="xs" fontWeight="bold" color="green.300" mb={1}>
                OUTCOME
              </Text>
              <Text fontSize="xs" color="gray.200">{selectedTrace.outcome}</Text>
            </Box>
          )}
        </Box>
      )}
    </Flex>
  );
}
