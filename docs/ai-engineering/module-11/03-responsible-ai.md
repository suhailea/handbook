---
title: Responsible AI — Bias, Fairness, Transparency, Compliance
outline: deep
---

# Responsible AI — Bias, Fairness, Transparency, Compliance

🔥🔥 Interview weight | Prerequisites: [ML 1.6 ML Metrics](/ml-foundations/module-01/06-ml-metrics)

## 🗣️ In Plain English

::: tip In Plain English
When an algorithm decides who gets a loan, who gets interviewed for a job, or who gets flagged as a fraud suspect — the fact that it's an algorithm doesn't make it neutral. It makes it scalable. A biased human reviewer might affect hundreds of decisions a year. A biased algorithm affects millions.

**Bias in AI** comes from several sources. If a hiring algorithm is trained on historical hiring data from a company that rarely hired women in technical roles, it learns to associate "good candidate" with "male." The bias in the training data becomes bias in the model. The algorithm isn't malicious — it's finding patterns. The patterns it found were unfair.

**Fairness** is the attempt to ensure that AI systems don't systematically disadvantage groups of people based on protected characteristics: race, gender, age, disability, nationality, religion. But "fairness" isn't one definition — it's several competing definitions that can't all be satisfied simultaneously. A loan model that has equal approval rates across demographic groups (demographic parity) might not be equally accurate across groups (equalized odds). Choosing which fairness definition to optimize for is an ethical decision, not a technical one.

**Transparency** means being honest about what the system does and doesn't do. When a user interacts with an AI and doesn't know it's an AI, that's a transparency failure. When a company uses AI to make consequential decisions but can't explain how, that's a transparency failure. Transparency includes: disclosing AI use, explaining decisions to affected people, and being honest about the model's limitations.

**Compliance** is the legal layer. GDPR (EU), CCPA (California), the EU AI Act, and sector-specific regulations (HIPAA for healthcare, Basel III for banking) impose specific obligations on how AI systems can process data, make decisions, and what rights users have. "We use AI for this" is no longer sufficient — you must demonstrate lawful processing, data minimization, and explainability.

Responsible AI isn't just ethics — it's engineering. The measures you implement to detect bias, provide explanations, maintain audit logs, and enable user rights are technical systems that must be designed and maintained.
:::

## ⚙️ Under the Hood

### Types of Bias in AI Systems

**Training data bias**: Historical data reflects historical inequalities. Credit scoring models trained on historical approval data learn to associate demographic features with creditworthiness — even if those features correlate with demographics only because of historical discrimination.

**Measurement bias**: What you measure affects what you learn. If you train a "job performance" predictor but measure performance only via manager ratings, and managers rate people of certain backgrounds differently, the model inherits that bias.

**Feedback loop bias**: The model's predictions affect future training data. A recidivism predictor labels high-risk people as high-risk → they receive more supervision → more violations are detected → model's training data confirms "high-risk" was right. The prediction becomes self-fulfilling.

**Label bias**: Human annotators apply labels inconsistently across demographic groups. An NLP model trained on human-labeled "toxic" comments may learn that certain dialects (AAVE) are more "toxic" because annotators labeled them differently.

```python
# run: python bias_detection.py
# pip install fairlearn aif360

import pandas as pd
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score

# Simulate biased training data
np.random.seed(42)
n = 10000

# Loan application data with historical bias
df = pd.DataFrame({
    'income': np.random.lognormal(10, 0.5, n),
    'credit_score': np.random.normal(650, 100, n),
    'debt_ratio': np.random.uniform(0.1, 0.8, n),
    'gender': np.random.choice(['M', 'F'], n, p=[0.6, 0.4]),
})

# Historical approval has gender bias built in (not legal, but real)
df['approved'] = (
    (df['income'] > 45000) &
    (df['credit_score'] > 620) &
    (df['debt_ratio'] < 0.5) &
    # Simulated historical bias: women 20% less likely to be approved even if qualified
    (~((df['gender'] == 'F') & (np.random.rand(n) < 0.2)))
).astype(int)

# Train on biased data
features = ['income', 'credit_score', 'debt_ratio']
X, y = df[features], df['approved']
model = LogisticRegression()
model.fit(X, y)

# Evaluate fairness
for gender in ['M', 'F']:
    mask = df['gender'] == gender
    y_pred = model.predict(X[mask])
    y_true = y[mask]

    approval_rate = y_pred.mean()
    accuracy = accuracy_score(y_true, y_pred)
    tp_rate = (y_pred[y_true == 1]).mean()  # True positive rate

    print(f"Gender={gender}: approval_rate={approval_rate:.3f}, "
          f"accuracy={accuracy:.3f}, TPR={tp_rate:.3f}")

# Expected output: similar accuracy but different approval rates → fairness concern
```

### Fairness Metrics

```python
# run: python fairness_metrics.py
import numpy as np

def fairness_metrics(y_true, y_pred, protected_attr, privileged_value) -> dict:
    """Compute key fairness metrics"""
    priv = protected_attr == privileged_value
    unpriv = ~priv

    # Demographic parity: equal approval rates across groups
    dp_priv = y_pred[priv].mean()
    dp_unpriv = y_pred[unpriv].mean()
    demographic_parity_ratio = dp_unpriv / dp_priv if dp_priv > 0 else 0

    # Equal opportunity: equal true positive rates across groups
    tpr_priv = y_pred[(priv) & (y_true == 1)].mean()
    tpr_unpriv = y_pred[(unpriv) & (y_true == 1)].mean()
    equal_opportunity_ratio = tpr_unpriv / tpr_priv if tpr_priv > 0 else 0

    # Equalized odds: equal TPR AND FPR across groups
    fpr_priv = y_pred[(priv) & (y_true == 0)].mean()
    fpr_unpriv = y_pred[(unpriv) & (y_true == 0)].mean()
    equalized_odds_tpr = equal_opportunity_ratio
    equalized_odds_fpr = fpr_unpriv / fpr_priv if fpr_priv > 0 else 0

    return {
        "demographic_parity_ratio": round(demographic_parity_ratio, 3),  # 1.0 = fair
        "equal_opportunity_ratio": round(equal_opportunity_ratio, 3),
        "equalized_odds_tpr": round(equalized_odds_tpr, 3),
        "equalized_odds_fpr": round(equalized_odds_fpr, 3),
        # Fair = all ratios close to 1.0
        # < 0.8 or > 1.25 is often considered concerning (4/5 rule)
        "concerns": []
            + (["demographic_parity"] if demographic_parity_ratio < 0.8 else [])
            + (["equal_opportunity"] if equal_opportunity_ratio < 0.8 else [])
    }

# Example usage
np.random.seed(42)
n = 1000
y_true = np.random.binomial(1, 0.4, n)
y_pred = np.random.binomial(1, 0.4, n)  # Random model
gender = np.random.choice(['M', 'F'], n)

metrics = fairness_metrics(y_true, y_pred, gender, 'M')
print("Fairness metrics:", metrics)
```

### Explainability — SHAP Values

```python
# run: python explainability_shap.py
# pip install shap

import shap
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.datasets import load_breast_cancer

# Train a model
X, y = load_breast_cancer(return_X_y=True, as_frame=True)
model = RandomForestClassifier(n_estimators=100, random_state=42)
model.fit(X, y)

# SHAP: explain individual predictions
explainer = shap.TreeExplainer(model)
shap_values = explainer.shap_values(X.iloc[:100])  # Explain first 100 samples

# Per-instance explanation
sample_idx = 0
print(f"Prediction: {model.predict_proba(X.iloc[[sample_idx]])[0]}")
print("\nFeature contributions (SHAP values for class 1):")
feature_importance = dict(zip(X.columns, shap_values[1][sample_idx]))
sorted_features = sorted(feature_importance.items(), key=lambda x: abs(x[1]), reverse=True)
for feature, value in sorted_features[:5]:
    direction = "increased" if value > 0 else "decreased"
    print(f"  {feature}: {direction} probability by {abs(value):.4f}")

# Global importance: which features matter most overall?
global_importance = np.abs(shap_values[1]).mean(axis=0)
feature_importance_global = dict(zip(X.columns, global_importance))
print("\nGlobal feature importance (mean |SHAP|):")
for feat, imp in sorted(feature_importance_global.items(), key=lambda x: x[1], reverse=True)[:5]:
    print(f"  {feat}: {imp:.4f}")
```

### Generating Human-Readable Explanations with LLMs

```typescript
// run: npx tsx ai_explanation.ts
import OpenAI from 'openai'

const client = new OpenAI()

interface DecisionFactors {
  model: string
  prediction: string
  confidence: number
  features: Array<{
    name: string
    value: string | number
    impact: 'positive' | 'negative' | 'neutral'
    importanceScore: number
  }>
}

async function generateExplanation(decision: DecisionFactors): Promise<string> {
  const topFactors = decision.features
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .slice(0, 3)

  const factorText = topFactors
    .map(f => `- ${f.name} (value: ${f.value}): ${f.impact} impact on decision`)
    .join('\n')

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Generate a clear, concise, non-technical explanation of an AI decision for a customer.
The explanation must:
1. State the decision and outcome
2. Explain the top 3 factors in plain English
3. Mention what could change the outcome
4. Use empathetic, professional language
Keep it under 150 words.`
      },
      {
        role: 'user',
        content: `Decision: ${decision.prediction} (confidence: ${(decision.confidence * 100).toFixed(0)}%)
Model: ${decision.model}
Key factors:
${factorText}

Generate the customer explanation:`
      }
    ],
    max_tokens: 200,
  })

  return response.choices[0].message.content ?? ''
}

// Example: loan decision explanation
const loanDecision: DecisionFactors = {
  model: 'loan-approval-v3',
  prediction: 'Application declined',
  confidence: 0.82,
  features: [
    { name: 'Debt-to-income ratio', value: '0.72', impact: 'negative', importanceScore: 0.45 },
    { name: 'Credit utilization', value: '85%', impact: 'negative', importanceScore: 0.30 },
    { name: 'Years of credit history', value: '2 years', impact: 'negative', importanceScore: 0.15 },
    { name: 'Annual income', value: '$48,000', impact: 'positive', importanceScore: 0.10 },
  ]
}

const explanation = await generateExplanation(loanDecision)
console.log(explanation)
```

### GDPR Compliance for AI Systems

```typescript
// run: npx tsx gdpr_ai_compliance.ts

// GDPR requirements for AI systems making consequential decisions

interface GDPRRequirements {
  // Article 13/14: Transparency obligations
  transparency: {
    informedAboutAI: boolean         // User knows AI is involved
    purposeDisclosed: boolean        // Why AI is making this decision
    dataUsedDisclosed: boolean       // What data was used
    retentionPeriodDisclosed: boolean
  }

  // Article 22: Automated decision-making rights
  automatedDecisionRights: {
    humanReviewAvailable: boolean    // User can request human review
    rightToExplain: boolean          // User can get explanation
    rightToContest: boolean          // User can contest the decision
    meaningfulExplanationProvided: boolean
  }

  // Article 17: Right to erasure
  erasure: {
    canDeleteUserData: boolean
    deletionPropagatesTrainingData: boolean  // Can you retrain without their data?
    auditTrailPreserved: boolean    // Some audit data may have overriding interest
  }

  // Article 25: Privacy by design
  privacyByDesign: {
    dataMinimization: boolean        // Only process data needed for the decision
    pseudonymization: boolean        // Use anonymized data where possible
    accessControls: boolean          // Only authorized parties access AI decisions
  }
}

class GDPRAIComplianceChecker {
  checkCompliance(system: GDPRRequirements): { compliant: boolean; gaps: string[] } {
    const gaps: string[] = []

    if (!system.transparency.informedAboutAI) {
      gaps.push('Users must be informed when AI is involved in decisions affecting them')
    }
    if (!system.automatedDecisionRights.humanReviewAvailable) {
      gaps.push('Article 22: Users must be able to request human review of automated decisions')
    }
    if (!system.automatedDecisionRights.meaningfulExplanationProvided) {
      gaps.push('Article 22: Meaningful explanation of automated decisions is required')
    }
    if (!system.erasure.canDeleteUserData) {
      gaps.push('Article 17: System must support right to erasure')
    }
    if (!system.privacyByDesign.dataMinimization) {
      gaps.push('Article 25: Only process data strictly necessary for the AI decision')
    }

    return { compliant: gaps.length === 0, gaps }
  }
}
```

### Audit Logging for AI Decisions

```typescript
// run: npx tsx ai_audit_log.ts

interface AIDecisionAuditRecord {
  // Immutable record of every AI decision
  id: string
  timestamp: string

  // Context
  userId: string           // Who the decision was about
  operatorId: string       // Who triggered the decision
  sessionId: string
  applicationId: string

  // The decision
  decisionType: string     // "loan_approval", "content_moderation", "fraud_detection"
  decisionOutcome: string  // "approved", "rejected", "flagged"
  confidenceScore: number
  modelVersion: string     // Exactly which model/version

  // Input (anonymized/hashed where possible)
  inputFeatures: Record<string, unknown>  // Data used for decision
  inputHash: string        // Hash for integrity verification

  // Output
  rawModelOutput: unknown  // Probability scores, logits
  finalDecision: string

  // Explanation
  topFeatures: Array<{ name: string; contribution: number }>
  humanExplanation: string  // Generated customer-facing explanation

  // Human involvement
  humanReviewRequired: boolean
  humanReviewerId?: string
  humanDecision?: string
  humanDecisionAt?: string

  // Compliance
  legalBasis: string       // "legitimate_interest", "consent", "contract"
  retainUntil: string      // Computed based on retention policy
}

class AIAuditSystem {
  async record(decision: AIDecisionAuditRecord): Promise<void> {
    // Write to immutable audit log (append-only storage)
    // WORM (Write Once Read Many) compliance
    // Cannot be modified after writing — integrity via cryptographic chain
    console.log('[AUDIT]', JSON.stringify({
      id: decision.id,
      timestamp: decision.timestamp,
      userId: decision.userId,
      decisionType: decision.decisionType,
      outcome: decision.decisionOutcome,
      model: decision.modelVersion,
    }))

    // Also write summary to queryable DB for reporting
    // Full record to cold storage (cheaper, compliant retention)
  }

  async generateCompllianceReport(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalDecisions: number
    decisionsByType: Record<string, number>
    fairnessMetrics: Record<string, number>
    humanReviewRate: number
    contestationRate: number
  }> {
    // Aggregate from audit log
    return {
      totalDecisions: 0,
      decisionsByType: {},
      fairnessMetrics: {},
      humanReviewRate: 0,
      contestationRate: 0,
    }
  }
}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Hiring AI trained on biased historical data:** A company uses AI to screen job applications, trained on historical hiring decisions. Historical decisions were made by hiring managers who (unconsciously) preferred certain university names, were influenced by name-based demographic assumptions, and preferred candidates who matched existing employee profiles. The AI learns these patterns. Qualified diverse candidates are systematically scored lower. Legal exposure: discrimination claims, regulatory investigation. Discovery: compute demographic breakdown of AI scores vs human scores on the same candidate pool; conduct disparate impact analysis. Fix: audit training labels; retrain with fairness constraints; require human review for all borderline cases; external bias audit.

**Missing right-to-explanation for loan denial:** A bank's AI loan system denies 40% of applications. Customers receive "Application declined" with no explanation. Under GDPR Article 22, applicants have the right to a meaningful explanation of automated decisions that significantly affect them. The bank receives enforcement action from the DPA (Data Protection Authority). Fix: implement mandatory explanation generation for all consequential automated decisions; provide a human review process; document the decision factors in the audit log; test that explanations are actually meaningful (not just "your credit score was insufficient").

**Model drift causes demographic performance gap:** A fraud detection model was trained on data from 2022. By 2024, purchasing patterns of certain demographic groups have shifted (due to economic changes). The model's false positive rate (flagging legitimate transactions as fraud) is now 3× higher for one demographic group than others. The issue is invisible unless you monitor model performance broken down by demographic group. Fix: regular fairness metric monitoring (not just overall accuracy); retrain on recent data; require demographic performance breakdowns in model release notes.

**AI system impersonates human without disclosure:** A customer service chatbot is deployed without any indication it's an AI. Multiple customers report being "deceived" when they realize mid-conversation. Some regulators (FTC in the US, various EU authorities) are treating undisclosed AI impersonation as a deceptive practice. Fix: always disclose AI nature at the start of any AI-handled interaction; make it easy for users to request human handoff; name the AI system clearly ("Hi, I'm Atlas, TaskFlow's AI assistant").
:::

## 🎯 Checkpoint

::: details Question 1 — Fairness metrics conflict
**Q:** You're building a credit scoring model. Demographic parity says equal approval rates across groups. Equal opportunity says equal true positive rates. Show why these two definitions often conflict, and how you make the design decision.

**A:** Conflict example: Group A has a 60% true default rate; Group B has a 30% true default rate. A perfectly calibrated model approves 40% of A applicants (high-risk group, fewer qualify) and 70% of B applicants. This violates demographic parity (approval rates are unequal) but achieves equal opportunity (both groups have the same true positive rate — the model is equally good at identifying creditworthy applicants in each group). To achieve demographic parity, you'd need to lower the threshold for Group A — which means approving higher-risk applicants in that group, leading to higher default rates and losses. This may seem fair by one measure but creates different problems. The design decision: regulatory context matters most. US Fair Lending law uses "disparate impact" (similar to demographic parity outcomes); the model must be validated not to have illegal disparate impact. Within that constraint, equal opportunity (loan repayment prediction accuracy) is the secondary optimization target. The decision must be made with legal counsel and potentially regulators involved — it is an ethical and legal decision, not a technical one.
:::

::: details Question 2 — GDPR Article 22 compliance
**Q:** Describe the technical systems required to comply with GDPR Article 22 for an AI system that automatically approves or rejects insurance claims.

**A:** Article 22 requires: (1) **Inform users** of automated decision-making before it occurs — include in policy documents, terms of service, and the claim submission interface. (2) **Provide meaningful explanation** when a decision is made — not "your claim was denied by our AI" but specifically: which features drove the decision, what thresholds were applied, and what would change the outcome. Technical: SHAP-based explanation per decision + human-readable text generation. (3) **Right to human review** — every automated decision must be contestable; there must be a clear process and an SLA for human review (e.g., 15 business days). Technical: implement a "Request Human Review" button; queue review tasks to human adjusters. (4) **Right to contest** — users can provide additional information and request reconsideration. Technical: re-run model with updated inputs + human adjuster review. (5) **Audit trail** — immutable record of every automated decision including model version, input features used, output scores, and explanation generated. Retain for the statute of limitations (typically 2-4 years for insurance). (6) **Regular fairness audits** — document and report demographic performance metrics quarterly; internal risk committee sign-off.
:::

## Key Mental Models

- **Bias in training data → bias in model output** — garbage in, garbage out; but with AI, the garbage is historical human bias that scales to millions of decisions.
- **Fairness has competing definitions that cannot all be satisfied simultaneously** — choosing which definition is an ethical decision, not a technical one.
- **GDPR Article 22 = legal right to explanation for consequential automated decisions** — build explainability as a first-class feature, not an afterthought.
- **Always disclose AI involvement** — users have the right to know when they're interacting with or being assessed by an AI system.
- **Audit logs are the foundation of compliance** — immutable, complete records of every AI decision enable rights fulfillment, incident investigation, and regulatory reporting.

## Related

- [11.2 Agent Security](./02-agent-security) — security controls that prevent unfair automated actions
- [9.3 Evaluation Pipeline](../module-09/03-evaluation-pipeline) — red teaming includes bias testing
- [ML 1.6 ML Metrics](/ml-foundations/module-01/06-ml-metrics) — the underlying metrics that fairness metrics extend
