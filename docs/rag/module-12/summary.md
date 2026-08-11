---
title: Module 12 Summary — Generation & Hallucination
outline: deep
---

# Module 12 Summary — Generation & Hallucination

## Mental Models Gained

1. **Grounding is faithfulness to context, not correctness.** A grounded response accurately reflects what the retrieved documents say. If the documents are wrong, the response is wrong but grounded — and the error is traceable.

2. **System prompt alone is insufficient for grounding.** Layer enforcement: structured output, answerability checks, citation requirements, low temperature, and post-generation validation.

3. **Retrieved documents are untrusted data.** Prompt injection via the retrieval path is a real attack vector. Treat context as data, never as instructions.

4. **Abstention is a feature, not a failure.** A system that says "I don't know" when appropriate builds more trust than one that always generates an answer.

5. **Most RAG hallucination is retrieval failure in disguise.** 60-70% of hallucination traces back to wrong or missing documents in the context. Fix retrieval before investing heavily in prompt engineering.

6. **Hallucination defense must be layered.** Better retrieval + better context + better prompting + post-generation validation + human review = defense in depth. No single technique is sufficient.

7. **Some hallucination is irreducible.** LLMs are probabilistic text generators. Target a hallucination rate (< 5% general, < 1% high-stakes), do not promise zero.

8. **Hallucination rate is a production metric.** Track it alongside latency and throughput. Alert on spikes. Sample-check if real-time validation is too expensive.

## Self-Assessment Checklist

- [ ] I can write a system prompt that enforces grounding, requires citations, and enables abstention
- [ ] I can explain the difference between intrinsic (contradiction) and extrinsic (addition) hallucination
- [ ] I can implement an LLM-as-judge faithfulness check
- [ ] I can design a multi-layer hallucination defense for a high-stakes domain
- [ ] I can explain why retrieval failure is the most common cause of RAG hallucination
- [ ] I can implement citation verification that checks claims against sources
- [ ] I can defend against prompt injection via retrieved documents
- [ ] I can set appropriate temperature and sampling parameters for factual RAG
- [ ] I can design a hallucination monitoring system with appropriate alert thresholds
- [ ] I can explain why zero hallucination is impossible and frame expectations correctly for stakeholders
