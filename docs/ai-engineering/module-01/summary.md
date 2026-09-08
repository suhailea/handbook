---
title: Module 1 Summary — LLMs & Prompting
outline: deep
---

# Module 1 Summary

Five things to remember from this module as we build TaskFlow's agent.

## Mental Models

**1. An LLM is autocomplete at scale.** It predicts the next token based on everything it was trained on. There's no understanding, no memory, no reasoning in the human sense. Keeping this in mind prevents you from anthropomorphizing it and making bad design decisions.

**2. Tokens are not words — and they're not free.** Every token in your context costs money on every request. The context window is the model's working memory; what doesn't fit is forgotten entirely. Design around token economics from day one.

**3. A system prompt is a literal job description.** The model does what you say, not what you mean. Vague prompts produce vague, unpredictable behavior. Specific constraints (scope, tone, prohibited actions) produce consistent behavior.

**4. Context engineering is a separate skill from prompt engineering.** Putting everything in context doesn't help — it hurts. The right question for every piece of context is: "does the model need this to answer this class of question?" If not, leave it out.

**5. Prompt caching and RAG are context cost optimization strategies, not academic concepts.** Use prompt caching for repeated prefixes. Use RAG when your knowledge base is large and only a subset is relevant per request. Both have immediate cost impact.

## What's next

Module 2 takes everything we've learned about talking to the model and extends it: giving the model the ability to take actions, not just generate text. That's where agents start.
