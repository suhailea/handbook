---
title: AKS and Azure — Cloud AI Infrastructure
outline: deep
---

# AKS and Azure — Cloud AI Infrastructure

🔥🔥 Interview weight | Prerequisites: [10.2 Kubernetes for AI](./02-kubernetes-for-ai)

## 🗣️ In Plain English

::: tip In Plain English
Azure Kubernetes Service (AKS) is Microsoft's managed Kubernetes. You get all the power of Kubernetes without managing the control plane — Microsoft handles the master node, etcd, and Kubernetes API server. You manage your workloads; Azure manages the platform.

For AI engineering on Azure, three services are the core:

**Azure Kubernetes Service (AKS)** runs your AI services at scale — the orchestration layer, the RAG engines, the agent services. It gives you GPU node pools when you need local model serving, and regular CPU/memory node pools for the API and orchestration layers.

**Azure OpenAI Service** is OpenAI's models (GPT-4o, GPT-4o-mini, text-embedding-3) running within Azure's cloud, within your chosen region, with Azure's data residency guarantees. For enterprise AI, data residency is often a legal requirement — "customer data must not leave the EU." Azure OpenAI lets you use GPT-4 capabilities while keeping data within your tenant.

**GPU Node Pools in AKS** are groups of VMs with NVIDIA GPUs (A100, H100, T4) that you add to your AKS cluster for running local model servers (vLLM, llama.cpp). These are expensive when running continuously — they're typically used on-demand or in node autoprovisioner mode where they scale to zero when unused.

The combination: Azure OpenAI handles the main AI workloads (fast, managed, no infrastructure). AKS GPU pools handle sensitive/private workloads that cannot use external APIs. AKS CPU pools handle all the orchestration, RAG engines, API gateways, and business logic.
:::

## ⚙️ Under the Hood

### AKS Cluster Architecture for AI

```
┌───────────────────────────────────────────────────────────────────┐
│                     AKS Cluster: ai-production                     │
│                                                                    │
│  ┌─────────────────────────┐  ┌──────────────────────────────┐   │
│  │   System Node Pool       │  │   AI Application Node Pool   │   │
│  │   (Standard_D4s_v3)      │  │   (Standard_D8s_v3)          │   │
│  │   3 nodes (always on)    │  │   Min: 2, Max: 20 (autoscale)│   │
│  │   - CoreDNS              │  │   - AI API Service            │   │
│  │   - KEDA                 │  │   - Orchestrator              │   │
│  │   - cert-manager         │  │   - RAG Engine                │   │
│  │   - monitoring agents    │  │   - Redis                     │   │
│  └─────────────────────────┘  └──────────────────────────────┘   │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │   GPU Node Pool (on-demand, can scale to 0)                │   │
│  │   (Standard_NC24ads_A100_v4 — NVIDIA A100 80GB)            │   │
│  │   Min: 0, Max: 4                                           │   │
│  │   - vLLM server (Mistral-7B, Llama-3-70B)                  │   │
│  │   - Only used for sensitive data that can't use Azure OpenAI│   │
│  └────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘

Connected Azure Services:
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ Azure OpenAI   │  │ Azure Container│  │ Azure Key Vault│
│ Service        │  │ Registry (ACR) │  │ (Secrets)      │
│ (GPT-4o, etc.) │  │ (Docker images)│  │                │
└────────────────┘  └────────────────┘  └────────────────┘
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ Azure Postgres │  │ Azure Cache    │  │ Azure Monitor  │
│ (with pgvector)│  │ for Redis      │  │ + App Insights │
└────────────────┘  └────────────────┘  └────────────────┘
```

### Provisioning AKS with Azure CLI

```bash
# run: bash (requires Azure CLI, az login)

# 1. Create resource group
az group create \
  --name rg-ai-production \
  --location eastus

# 2. Create AKS cluster with system node pool
az aks create \
  --resource-group rg-ai-production \
  --name aks-ai-production \
  --node-count 3 \
  --node-vm-size Standard_D4s_v3 \
  --enable-managed-identity \
  --enable-oidc-issuer \
  --enable-workload-identity \     # For pod-level Azure identity (no secret needed)
  --network-plugin azure \
  --network-policy azure \
  --enable-addons monitoring \
  --attach-acr ai-production-acr \ # Grant AKS pull access to ACR
  --generate-ssh-keys

# 3. Add AI application node pool
az aks nodepool add \
  --resource-group rg-ai-production \
  --cluster-name aks-ai-production \
  --name aiapp \
  --node-count 2 \
  --min-count 2 \
  --max-count 20 \
  --enable-cluster-autoscaler \
  --node-vm-size Standard_D8s_v3 \
  --labels workload=ai-app \
  --node-taints workload=ai:NoSchedule  # Only AI workloads here

# 4. Add GPU node pool (scales to zero when not needed)
az aks nodepool add \
  --resource-group rg-ai-production \
  --cluster-name aks-ai-production \
  --name gpupool \
  --node-count 0 \
  --min-count 0 \
  --max-count 4 \
  --enable-cluster-autoscaler \
  --node-vm-size Standard_NC24ads_A100_v4 \
  --node-taints nvidia.com/gpu=present:NoSchedule \
  --labels accelerator=nvidia-a100 \
  --aks-custom-headers UseGPUDedicatedVHD=true  # GPU-optimized OS image

# 5. Get credentials
az aks get-credentials \
  --resource-group rg-ai-production \
  --name aks-ai-production
```

### Azure OpenAI Service Integration

```typescript
// run: npx tsx azure_openai.ts
// npm install @azure/openai @azure/identity

import { AzureOpenAI } from 'openai'
import { DefaultAzureCredential } from '@azure/identity'

// Option 1: API Key authentication (simpler, less secure)
const clientWithKey = new AzureOpenAI({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,      // https://myinstance.openai.azure.com/
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
  apiVersion: '2024-10-21',
})

// Option 2: Managed Identity (recommended for AKS — no secrets needed)
// The AKS pod's identity is granted access to the Azure OpenAI resource
const credential = new DefaultAzureCredential()
const clientWithMSI = new AzureOpenAI({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  apiVersion: '2024-10-21',
  azureADTokenProvider: async () => {
    const token = await credential.getToken('https://cognitiveservices.azure.com/.default')
    return token.token
  },
})

// Azure OpenAI uses "deployments" not models directly
// You deploy gpt-4o as a deployment named "gpt-4o-prod"
async function chat(userMessage: string): Promise<string> {
  const response = await clientWithKey.chat.completions.create({
    model: 'gpt-4o-prod',           // Azure deployment name, not model name
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: userMessage }
    ],
    max_tokens: 2000,
  })
  return response.choices[0].message.content ?? ''
}

// Azure OpenAI: same tokens/pricing as OpenAI direct
// But: data stays in your Azure tenant, in your chosen region
// PTU (Provisioned Throughput Units): reserved capacity for consistent latency
// Good for high-volume enterprise: predictable cost, no rate limits
```

### Azure OpenAI Deployment Configuration

```bash
# Create Azure OpenAI resource
az cognitiveservices account create \
  --name ai-openai-production \
  --resource-group rg-ai-production \
  --location eastus \
  --kind OpenAI \
  --sku S0

# Deploy GPT-4o model
az cognitiveservices account deployment create \
  --name ai-openai-production \
  --resource-group rg-ai-production \
  --deployment-name gpt-4o-prod \
  --model-name gpt-4o \
  --model-version "2024-11-20" \
  --model-format OpenAI \
  --sku-capacity 100 \    # 100K tokens per minute (TPM)
  --sku-name Standard

# Deploy embedding model
az cognitiveservices account deployment create \
  --name ai-openai-production \
  --resource-group rg-ai-production \
  --deployment-name text-embedding-3-small \
  --model-name text-embedding-3-small \
  --model-version "1" \
  --model-format OpenAI \
  --sku-capacity 350 \    # 350K tokens per minute
  --sku-name Standard
```

### Workload Identity for Pods

The preferred way to give AKS pods access to Azure services without storing secrets:

```yaml
# workload-identity.yaml
# 1. Service Account with Azure workload identity annotation
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ai-orchestrator-sa
  namespace: ai-production
  annotations:
    azure.workload.identity/client-id: "<managed-identity-client-id>"

---
# 2. Pod uses the service account (which has Azure identity)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-orchestrator
spec:
  template:
    metadata:
      labels:
        azure.workload.identity/use: "true"   # Enable workload identity
    spec:
      serviceAccountName: ai-orchestrator-sa
      containers:
      - name: orchestrator
        image: myacr.azurecr.io/ai-orchestrator:latest
        env:
        - name: AZURE_OPENAI_ENDPOINT
          value: "https://ai-openai-production.openai.azure.com/"
        # No API key needed! Pod's managed identity has access
```

```bash
# Grant managed identity access to Azure OpenAI
az role assignment create \
  --assignee <managed-identity-client-id> \
  --role "Cognitive Services OpenAI User" \
  --scope /subscriptions/.../resourceGroups/rg-ai-production/providers/Microsoft.CognitiveServices/accounts/ai-openai-production
```

### vLLM on GPU Nodes

```yaml
# vllm-deployment.yaml — running Mistral-7B on AKS GPU nodes
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-mistral-7b
  namespace: ai-local-models
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vllm-mistral-7b
  template:
    metadata:
      labels:
        app: vllm-mistral-7b
    spec:
      nodeSelector:
        accelerator: nvidia-a100    # Only schedule on A100 GPU nodes

      tolerations:
      - key: "nvidia.com/gpu"
        operator: "Exists"
        effect: "NoSchedule"

      initContainers:
      # Download model from Azure Blob Storage if not already cached
      - name: model-downloader
        image: mcr.microsoft.com/azure-cli:latest
        command:
        - sh
        - -c
        - |
          if [ ! -f /models/mistral-7b-instruct/config.json ]; then
            echo "Downloading model..."
            az storage blob download-batch \
              --account-name aimodels \
              --source models/mistral-7b-instruct \
              --destination /models/mistral-7b-instruct \
              --auth-mode login
          else
            echo "Model already cached"
          fi
        volumeMounts:
        - name: model-storage
          mountPath: /models

      containers:
      - name: vllm
        image: vllm/vllm-openai:v0.6.0
        args:
        - --model
        - /models/mistral-7b-instruct
        - --host
        - "0.0.0.0"
        - --port
        - "8000"
        - --tensor-parallel-size
        - "1"
        - --max-model-len
        - "32768"
        - --served-model-name
        - mistral-7b-instruct     # Name used in API calls

        resources:
          limits:
            nvidia.com/gpu: "1"
            memory: 60Gi
            cpu: "8"
          requests:
            nvidia.com/gpu: "1"
            memory: 40Gi
            cpu: "4"

        volumeMounts:
        - name: model-storage
          mountPath: /models
          readOnly: true

        startupProbe:
          httpGet:
            path: /health
            port: 8000
          failureThreshold: 60    # 10 minutes for model loading
          periodSeconds: 10

      volumes:
      - name: model-storage
        persistentVolumeClaim:
          claimName: model-storage-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: vllm-service
  namespace: ai-local-models
spec:
  selector:
    app: vllm-mistral-7b
  ports:
  - port: 8000
    targetPort: 8000
  type: ClusterIP
```

### KEDA — Kubernetes Event-Driven Autoscaling

For AI services, KEDA can scale based on Azure Queue depth (much more relevant than CPU):

```yaml
# keda-scaledobject.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: ai-worker-scaler
  namespace: ai-production
spec:
  scaleTargetRef:
    name: ai-worker-deployment
  minReplicaCount: 1
  maxReplicaCount: 50

  triggers:
  # Scale based on Azure Service Bus queue depth
  - type: azure-servicebus
    metadata:
      queueName: ai-task-queue
      messageCount: "10"    # Scale up when >10 messages per pod
    authenticationRef:
      name: keda-servicebus-auth

  # Also scale on Redis list length
  - type: redis
    metadata:
      listName: ai:job-queue
      listLength: "5"       # 5 jobs per worker
      address: redis-service:6379
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Azure OpenAI token-per-minute (TPM) limits cause rate errors:** A team deploys an agent that makes multiple LLM calls per user request. At 100 concurrent users, each making 5 LLM calls of ~3,000 tokens each: 100 × 5 × 3,000 = 1.5M TPM. Standard tier limit: 100K TPM. Agents return `429 Too Many Requests` errors under load. Fix: request PTU (Provisioned Throughput Units) for predictable high-volume; implement exponential backoff with jitter on 429s; use a request queue with back-pressure; spread load across multiple Azure OpenAI deployments in different regions.

**GPU node pool never scales to zero:** AKS cluster autoscaler can't scale GPU nodes to zero if any Pod uses `PersistentVolumeClaim` that's bound to a node-local volume, or if a DaemonSet runs on the GPU node. Engineers notice the GPU VM running 24/7 at $25/hour even when idle. Fix: use Azure Files or Azure Blob CSI driver for model storage (network-attached, detachable); ensure no DaemonSets schedule on GPU nodes; configure `--scale-down-delay-after-empty=5m` on the autoscaler.

**Managed Identity not assigned to the correct scope:** Pod uses workload identity but gets 403 when calling Azure OpenAI. The managed identity has "Cognitive Services User" role at the subscription level, but the Azure OpenAI resource is in a different resource group with a custom RBAC policy. Fix: always assign roles at the specific resource scope, not subscription-wide; use `az role assignment list --assignee <client-id>` to verify; check Azure Activity Logs for the specific 403 rejection.

**vLLM OOM on A100:** A 13B model is loaded on an A100 80GB GPU. It loads fine but when processing a batch of 32K-token requests, GPU memory usage spikes beyond 80GB and the OOM killer terminates the process. The model FP16 weights are 26GB, but KV cache for 32K tokens at FP16 consumes another 60GB+. Fix: reduce `--max-model-len` to limit maximum sequence length; enable `--kv-cache-dtype float8` for quantized KV cache; use AWQ/GPTQ quantized model weights (4-bit = 6.5GB instead of 26GB); set `--gpu-memory-utilization 0.85` to leave 15% headroom.
:::

## 🎯 Checkpoint

::: details Question 1 — Azure OpenAI vs OpenAI Direct
**Q:** A European financial services company wants to use GPT-4o for customer document processing. They have regulatory requirements that customer data cannot leave the EU. Can they use OpenAI's direct API? What's the alternative?

**A:** OpenAI's direct API (`api.openai.com`) routes requests through OpenAI's infrastructure, which is primarily US-based. Customer document content sent in prompts passes through US servers — this violates the EU data residency requirement. Alternative: **Azure OpenAI Service** deployed in the `swedencentral` or `francecentral` Azure region. The GPT-4o model is hosted within Azure's EU data centers, customer data never leaves the EU boundary, and Microsoft's DPA (Data Processing Agreement) complies with GDPR. Azure OpenAI provides: same GPT-4o model capabilities, EU data residency guarantee, Azure tenant isolation (data not used for model training by default), enterprise SLA. Additional measures: use VNet-integrated AKS so traffic to Azure OpenAI goes through a private endpoint (never traverses public internet), configure Azure OpenAI with `deny public network access`, add Azure Policy to audit data-out flows.
:::

::: details Question 2 — GPU cost optimization
**Q:** Your team runs vLLM on an AKS A100 GPU node ($30/hour) 24/7 for a model used only during business hours (8am-6pm). How would you reduce cost while maintaining availability during business hours?

**A:** Three strategies: (1) **Scale to zero with node autoprovisioner**: Set GPU node pool `minCount: 0`, set up KEDA trigger on a queue/metric. During business hours, jobs queue in Azure Service Bus; KEDA scales up the GPU node when queue depth > 0. Cold start time: ~8 minutes (VM provisioning) + 5 minutes (model loading) = 13 minutes. Acceptable if workloads can queue. (2) **Scheduled scaling**: Use KEDA cron trigger to pre-provision the GPU node at 7:45am and de-provision at 6:30pm. Cost: 10.75 hours/day × $30 = $322.50/day vs $720/day (24h). Saves 55%. (3) **Azure Spot VMs for the GPU pool**: A100 spot instances cost ~60-80% less but can be preempted. Implement checkpointing and preemption handling in the vLLM service; use priority class to allow non-spot fallback. For critical production: combine (2) + (3) — scheduled with spot pricing during off-peak, switch to on-demand during business hours for reliability. Also consider: Azure Reserved Instances if 24/7 operation is ultimately needed (1-year reservation = ~30% discount).
:::

## Key Mental Models

- **Azure OpenAI = OpenAI's models in your Azure tenant** — same capabilities, EU data residency, no prompts used for training.
- **Workload Identity eliminates secrets** — pods get Azure access through their managed identity; no API keys in environment variables.
- **GPU node pools should scale to zero when idle** — $30+/hour for idle GPU nodes is a significant cost; design for zero-downtime cold start.
- **PTU (Provisioned Throughput) for predictable high volume** — pay-per-token pricing has rate limits; PTU gives reserved capacity with consistent latency.
- **KEDA extends HPA** — event-driven autoscaling on Azure queues, Redis lists, and custom metrics is more relevant for AI than CPU-based scaling.

## Related

- [10.2 Kubernetes for AI](./02-kubernetes-for-ai) — K8s concepts for the workloads running here
- [10.4 AI Infrastructure Patterns](./04-ai-infrastructure-patterns) — GPU memory and serving optimization
- [Module 3.3 vLLM](/ai-engineering/module-03/03-vllm) — vLLM internals running inside AKS GPU pods
