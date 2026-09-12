---
title: NLP Fundamentals — Tokenization, NER, Semantic Similarity
outline: deep
---

# NLP Fundamentals — Tokenization, NER, Semantic Similarity

🔥🔥 Interview weight | Prerequisites: [1.5 Linear Algebra for AI](../module-01/05-linear-algebra-for-ai)

## 🗣️ In Plain English

::: tip In Plain English
Before a machine learning model can process language, it needs to convert text into numbers. The pipeline for doing this has several stages — and understanding each stage helps you debug the surprising failures that happen when text doesn't behave the way you expect.

**Tokenization** is the first step: splitting text into the pieces the model works with. This isn't as simple as splitting on spaces. "don't" might become ["don", "'t"]. "ChatGPT" might become ["Chat", "G", "PT"]. The specific rules depend on how the model was trained. A word that exists in English but is rare (like "hepatosplenomegaly") might get split into 10 character-level pieces. This affects how many tokens you pay for, how the model processes the text, and why some prompts are mysteriously more expensive than others.

**Stemming and Lemmatization** reduce words to their root form. "running", "runs", "ran" all map to "run". This was crucial in the pre-neural era when every unique word was a separate feature. Today, transformer models handle these variations naturally (they've seen them all during training). But classical search engines still use stemming, so understanding it helps when hybrid search is involved.

**Named Entity Recognition (NER)** identifies real-world entities in text: "Apple announced a new product in Cupertino" → {Apple: Organization, Cupertino: Location}. This is a labeling task — the model assigns a category to each word or word span. NER is used in document processing, contract analysis, and pre-processing pipelines before feeding text to LLMs.

**Sentiment Analysis** classifies the emotional tone of text: positive, negative, or neutral. A simple application, but illustrative of the general pattern — text goes in, a label comes out.

**Semantic Similarity** asks: "are these two sentences saying the same thing?" Two sentences might use completely different words but mean the same thing. Traditional keyword matching fails here; embedding similarity succeeds. This is the core technology behind RAG retrieval, semantic search, and duplicate detection.

All of these tasks — from tokenization to semantic similarity — are the building blocks that modern AI engineering systems use to process, understand, and search text at scale.
:::

## ⚙️ Under the Hood

### Tokenization

Modern LLMs use **subword tokenization**, specifically Byte-Pair Encoding (BPE) or its variants:

**BPE algorithm:**
1. Start with individual characters as the vocabulary
2. Count all consecutive character pair frequencies
3. Merge the most frequent pair into a new token
4. Repeat until vocabulary size is reached (e.g., 50,000 tokens for GPT-4)

This gives common words their own token, while rare words are split into subword pieces.

```python
# run: python tokenization_demo.py
# pip install tiktoken transformers
import tiktoken

# GPT-4 tokenizer
enc = tiktoken.get_encoding("cl100k_base")  # GPT-4 encoding

texts = [
    "Hello world",
    "don't stop believing",
    "hepatosplenomegaly",       # medical term — many tokens
    "ChatGPT",                  # might surprise you
    "كيف حالك",                 # Arabic
    "   leading spaces   ",    # whitespace handling
    "2024-01-15T10:30:00Z",   # ISO date
]

for text in texts:
    tokens = enc.encode(text)
    decoded = [enc.decode([t]) for t in tokens]
    print(f"{text!r:<30} → {len(tokens):3d} tokens: {decoded}")

# Count tokens for cost estimation
long_text = "word " * 1000
n_tokens = len(enc.encode(long_text))
print(f"\n1000-word text: ~{n_tokens} tokens")
# Rule of thumb: ~0.75 tokens per English word; varies by language
```

**Why tokenization matters for engineers:**

1. **Cost**: GPT-4 charges per token. "I need help with my Python code" = ~9 tokens; the same in Japanese might be 15+ tokens.
2. **Context window**: "128K token context" means 128K tokens, not words. A 100-page PDF might be 75,000+ tokens.
3. **Prompt sensitivity**: splitting a word across tokens changes how the model processes it. "un|usual" is two tokens; "unusual" might be one. This can affect model behavior on tasks involving specific words.

### Stemming and Lemmatization

```python
# run: python stemming_demo.py
# pip install nltk spacy
import nltk
from nltk.stem import PorterStemmer, WordNetLemmatizer

nltk.download('wordnet', quiet=True)
nltk.download('omw-1.4', quiet=True)

stemmer = PorterStemmer()
lemmatizer = WordNetLemmatizer()

words = ["running", "runs", "ran", "easily", "studies", "studied", "better"]
for word in words:
    stem = stemmer.stem(word)
    lemma_verb = lemmatizer.lemmatize(word, pos='v')  # verb form
    lemma_noun = lemmatizer.lemmatize(word, pos='n')  # noun form
    print(f"{word:<12} | stem: {stem:<12} | lemma(v): {lemma_verb:<12} | lemma(n): {lemma_noun}")

# Stemmer: aggressive, rule-based, may not produce real words
# "studies" → "studi" (not a real word)
# Lemmatizer: dictionary-based, always produces real words
# "studies" → "study"
```

**When to use:** Elasticsearch and BM25-based keyword search still benefit from stemming/lemmatization to improve recall. Transformer embeddings don't need it (they handle inflections through training). When building hybrid search systems, apply stemming in the keyword search leg.

### Named Entity Recognition (NER)

NER is a sequence labeling task using IOB (Inside-Outside-Beginning) tagging:
- **B-ORG**: Beginning of an Organization entity
- **I-ORG**: Inside an Organization entity
- **O**: Outside any entity

"Apple announced a deal with Microsoft" → [B-ORG, O, O, O, O, B-ORG]

```python
# run: python ner_demo.py
# pip install spacy
# python -m spacy download en_core_web_sm
import spacy

nlp = spacy.load("en_core_web_sm")

texts = [
    "Apple announced a new product at their Cupertino headquarters on Tuesday.",
    "Elon Musk's Tesla reported $25 billion in revenue for Q3 2024.",
    "The European Union's GDPR regulation affects companies worldwide.",
    "GPT-4 was released by OpenAI in March 2023.",
]

for text in texts:
    doc = nlp(text)
    entities = [(ent.text, ent.label_, spacy.explain(ent.label_)) for ent in doc.ents]
    print(f"\nText: {text}")
    print(f"Entities: {entities}")

# spaCy entity types: PERSON, ORG, GPE (geopolitical), DATE, MONEY, PRODUCT, etc.
```

**Production NER considerations:**
- SpaCy's small model is fast but less accurate. Use `en_core_web_lg` or transformer-based models for production.
- Domain-specific NER (medical, legal, financial) requires fine-tuned models — generic NER misses domain entities.
- NER accuracy drops significantly on noisy text (social media, OCR output).

### Part-of-Speech (POS) Tagging

Assigns grammatical roles: noun, verb, adjective, etc. Used in rule-based NLP systems and feature engineering.

```python
# run: python pos_demo.py
import spacy
nlp = spacy.load("en_core_web_sm")

doc = nlp("The quick brown fox jumps over the lazy dog.")
for token in doc:
    print(f"{token.text:<15} {token.pos_:<8} {token.tag_:<8} {token.dep_}")
# NOUN, VERB, ADJ, ADV, DET, ADP (preposition), etc.
# dep_: syntactic dependency (nsubj, dobj, amod, etc.)
```

### Sentiment Analysis

```python
# run: python sentiment_demo.py
# pip install transformers torch
from transformers import pipeline

# BERT-based sentiment classifier (fine-tuned on SST-2)
sentiment = pipeline("sentiment-analysis", model="distilbert-base-uncased-finetuned-sst-2-english")

texts = [
    "The product works great and arrived on time!",
    "Terrible customer service, I waited 3 hours.",
    "The product is okay, not amazing but does the job.",
    "I LOVE this so much!!!",  # emphasis
    "Not bad at all, would consider buying again.",  # negation
]

for text in texts:
    result = sentiment(text)[0]
    print(f"{result['label']:<10} ({result['score']:.3f}): {text}")
```

**Beyond binary sentiment:**
- **Aspect-based sentiment**: "The screen is great but the battery is terrible" → {screen: positive, battery: negative}
- **Emotion detection**: anger, joy, fear, disgust, surprise, sadness
- **Multilingual**: models like XLM-RoBERTa handle 100+ languages

### Semantic Similarity

Traditional keyword matching: "car" and "automobile" have zero overlap → distance = 0 similarity.
Semantic similarity: both map to similar embedding vectors → high cosine similarity.

```python
# run: python semantic_similarity.py
# pip install sentence-transformers
from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer("all-MiniLM-L6-v2")  # fast, small, good quality

sentence_pairs = [
    ("I love programming in Python", "Python is my favorite language"),
    ("The sky is blue", "The car is red"),
    ("How do I reset my password?", "I forgot my account password"),
    ("What is machine learning?", "Explain artificial intelligence"),
    ("Order status update", "Where is my package?"),
]

sentences_a = [pair[0] for pair in sentence_pairs]
sentences_b = [pair[1] for pair in sentence_pairs]

embeddings_a = model.encode(sentences_a)
embeddings_b = model.encode(sentences_b)

def cosine_sim(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

print(f"{'Pair':<5} {'Similarity':<12} Sentence A")
for i, (a, b) in enumerate(sentence_pairs):
    sim = cosine_sim(embeddings_a[i], embeddings_b[i])
    print(f"{i+1:<5} {sim:>10.4f}   {a[:50]}")
```

### Text Classification Pipeline

The canonical end-to-end NLP pipeline:

```python
# run: python text_classification_pipeline.py
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

# Simulated support tickets with labels
tickets = [
    ("charge on my account is wrong", "billing"),
    ("invoice shows incorrect amount", "billing"),
    ("refund not received after 7 days", "billing"),
    ("server returns 500 error", "technical"),
    ("API timeout on large requests", "technical"),
    ("my integration is broken", "technical"),
    ("please add dark mode", "feature"),
    ("can you support CSV export", "feature"),
    ("need bulk delete functionality", "feature"),
] * 50  # repeat for demo size

texts, labels = zip(*tickets)
texts, labels = list(texts), list(labels)

X_train, X_test, y_train, y_test = train_test_split(texts, labels, test_size=0.2, random_state=42)

# TF-IDF + Logistic Regression baseline
baseline = Pipeline([
    ('tfidf', TfidfVectorizer(ngram_range=(1, 2), max_features=5000)),
    ('clf', LogisticRegression(C=1.0, max_iter=1000)),
])
baseline.fit(X_train, y_train)
y_pred = baseline.predict(X_test)
print("TF-IDF + LR baseline:")
print(classification_report(y_test, y_pred))

# TF-IDF weights: term frequency × log(N/df) where df = document frequency
# High TF-IDF: word appears frequently in this document but rarely overall
tfidf = baseline.named_steps['tfidf']
feature_names = tfidf.get_feature_names_out()
# Top features for "billing" class
lr = baseline.named_steps['clf']
billing_idx = list(lr.classes_).index('billing')
top_billing = feature_names[lr.coef_[billing_idx].argsort()[-10:][::-1]]
print(f"\nTop TF-IDF features for 'billing': {top_billing}")
```

### Zero-Shot and Few-Shot NLP with LLMs

Modern AI engineering often skips the training pipeline entirely by using LLMs for NLP tasks:

```python
# run: python zero_shot_nlp.py
# pip install openai
from openai import OpenAI

client = OpenAI()

def classify_ticket(ticket_text: str) -> dict:
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": """Classify the support ticket into one of: billing, technical, feature_request, other.
Also extract any entities (product names, error codes, dates).
Respond as JSON: {"category": "...", "confidence": 0.0-1.0, "entities": [...], "sentiment": "positive|negative|neutral"}"""
            },
            {"role": "user", "content": ticket_text}
        ],
        response_format={"type": "json_object"},
    )
    import json
    return json.loads(response.choices[0].message.content)

# Test
result = classify_ticket("I've been waiting 2 weeks for my refund of $149.99 for order #84729")
print(result)
# LLM gives you classification + NER + sentiment in one call, zero training data
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Token count surprises in production:** A legal document processing system estimates costs based on word count (1 word ≈ 1 token). The actual document contains dense legal terminology, citations, and table-of-contents headers. Token count is 2.3× higher than estimated. Monthly cost 2× over budget. Fix: always measure token counts with the actual tokenizer before estimating costs. Build a token estimation step into the preprocessing pipeline.

**Stemming creating false matches in hybrid search:** A hybrid search system (BM25 + embedding) applies Porter stemmer to improve BM25 recall. "universe" and "universal" both stem to "univers" — now a query about "universal healthcare" incorrectly boosts documents about "the universe". Stemmer doesn't understand semantic context. Fix: use conservative stemmers or lemmatizers; validate with human evaluation; disable stemming for proper nouns and domain terms.

**NER mislabeling domain entities:** A financial document classifier uses spaCy's generic NER. "Apple" is labeled as ORG (correct for the company) but "Apple" as a fruit is also labeled ORG (wrong). More critically, financial instrument names ("AAPL", "SPX500") aren't recognized at all. A contract AI system misses clause entities because they don't match the trained entity types. Fix: fine-tune NER on domain data; use rule-based matchers for known patterns (ticker symbols, CUSIP numbers, clause identifiers).

**Embedding model mismatch for multilingual content:** A RAG system encodes all documents with an English-only embedding model. 30% of customer queries arrive in Spanish. English-only embeddings fail to match Spanish queries to Spanish documents. Cosine similarity between cross-lingual pairs is near-random. Fix: use multilingual embedding models (multilingual-e5, paraphrase-multilingual-MiniLM) or translate queries to English before embedding.
:::

## 🎯 Checkpoint

::: details Question 1 — Why subword tokenization?
**Q:** Why do LLMs use subword tokenization (BPE) rather than word-level or character-level tokenization? What are the tradeoffs?

**A:** **Word-level tokenization**: vocabulary becomes unbounded (every new word, proper noun, spelling variant is a new token). Out-of-vocabulary words are replaced with [UNK], losing all information. A model with 50K vocabulary tokens can't handle domain-specific terminology or non-English words effectively. **Character-level tokenization**: vocabulary is tiny (~200 characters), never has OOV. But sequences become extremely long (every character is a separate step), requiring much more compute and memory. Long-range dependencies become harder to learn. **Subword tokenization (BPE)**: bounded vocabulary (50K-100K), handles any text (rare words split into known pieces), reasonable sequence lengths. Tradeoffs: (1) tokenization is language-dependent — some languages need more tokens per word; (2) token boundary effects — the model may process "##ing" differently than "ing" as a standalone; (3) tokenizer must match between training and inference — using the wrong tokenizer produces garbage input.
:::

::: details Question 2 — Semantic similarity vs keyword search
**Q:** A user searches for "how do I fix a flat tire?" Your corpus contains a document titled "Puncture repair guide for pneumatic wheels". Why does keyword search fail and semantic similarity succeed?

**A:** Keyword search (TF-IDF, BM25) computes similarity based on token overlap. "fix" ≠ "repair"; "flat tire" ≠ "puncture"; "how do I" doesn't appear. Despite high semantic relevance, keyword overlap is near zero — the document ranks poorly. Semantic similarity (dense retrieval with embeddings): both sentences were seen in training contexts that demonstrate they refer to the same activity — automotive tire repair. The embedding model has learned that "flat tire" and "puncture" appear in similar semantic contexts; "fix" and "repair" are synonyms. Their embedding vectors point in similar directions in the 768-dimensional space. Cosine similarity is high (~0.85+). Dense retrieval ranks the document at or near the top. This is why hybrid search (keyword + semantic) dominates in production: keyword handles exact matches and proper nouns; semantic handles paraphrase and synonym retrieval.
:::

## Key Mental Models

- **Tokenization defines the model's atomic unit** — always measure token counts with the actual tokenizer; word count is not a reliable proxy.
- **Subword tokenization trades vocabulary size for sequence length** — rare words become multiple tokens; this affects both cost and model behavior.
- **Semantic similarity requires embeddings** — keyword matching cannot find paraphrases; embeddings capture meaning independent of surface form.
- **Classical NLP (NER, POS, stemming) still lives in hybrid systems** — pure LLM solutions are often better but more expensive; know when to use each.
- **LLMs can replace entire NLP pipelines via zero-shot prompting** — but at 50-100× the cost of a fine-tuned classifier for high-volume tasks.

## Related

- [1.5 Linear Algebra for AI](../module-01/05-linear-algebra-for-ai) — the vector math that makes semantic similarity work
- [RAG Module 7 — Embeddings](/rag/module-07/01-embeddings-similarity) — embedding models in production retrieval
- [Module 1.1 LLMs & Tokens](/ai-engineering/module-01/01-llms-and-tokens) — tokenization as it affects LLM prompting
