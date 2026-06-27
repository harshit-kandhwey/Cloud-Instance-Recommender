# 🌐 Cloud Instance Recommender

A comprehensive web-based tool for generating optimal cloud instance recommendations across AWS, Azure, and Google Cloud Platform (GCP). Upload a VM inventory CSV and get right-sized instance recommendations — all processing happens entirely in your browser, no data is ever sent to a server.

![Cloud Instance Recommender](https://img.shields.io/badge/Cloud-Instance%20Recommender-blue)
![Version](https://img.shields.io/badge/Version-3.0-green)
![License](https://img.shields.io/badge/License-Proprietary-red)

> **🌐 Live Demo**: [https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/](https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/)

---

## 🚀 Features

### 📊 Multi-Cloud Support

- **AWS** — EC2 instance recommendations with Graviton (ARM) support
- **Azure** — Virtual Machine sizing with ARM (Ampere Altra) instances
- **GCP** — Compute Engine optimization with T2A (ARM) instances
- **Multi-Cloud** — Side-by-side comparison across all three providers in one run

### 🎯 Recommendation Types

- **Like-to-Like** — Cheapest instance that meets or exceeds current vCPUs and memory
- **Optimized** — Smart right-sizing based on actual CPU/memory utilization (N/2, N, N+1 strategy)
- **Both** — Generate like-to-like and optimized simultaneously; AWS produces two separate bulk template files

### 🧠 Rule Engine (v3.0)

Five interactive dropdowns set global defaults for the entire batch without editing your CSV:

| Dropdown       | Purpose                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------- |
| **ENV**        | Production / Staging / Dev / Test — tightens generation and burstable rules                    |
| **OS**         | Linux / Windows / macOS — affects ARM eligibility                                              |
| **Workload**   | General / Database / Web Server / Cache / ML/AI / Batch / HPC — sorts preferred families first |
| **Compliance** | PCI / HIPAA / SOC2 / FIPS — enforces current-gen; Nitro Enclaves required for PCI/HIPAA (AWS)  |
| **Min Gen**    | Minimum generation number/family — excludes older instance generations                         |

Per-row CSV column values always override these global defaults.

### ⚠️ Conflict Detection

The Rule Engine highlights contradicting filter combinations in red and explains the conflict:

- Current-Gen Only + Previous-Gen preference
- Burstable excluded (Prod ENV) + Burstable family selected
- Min Gen + Current Gen Only (redundant but not conflicting)

### 🔧 Advanced Filtering

- **Current Generation Only** — Exclude end-of-life families
- **Minimum Generation** — Per-row `Min Gen` CSV column or global default dropdown
- **Processor Types** — Intel, AMD, ARM (unified across providers in multi-cloud)
- **Instance Categories** (multi-cloud) — General Purpose, Burstable, Memory Optimized, Compute Optimized, Storage Optimized, GPU, HPC
- **Exclude Specific Types** — GPU, Burstable, ARM, FPGA, Promo, etc. per provider

### 📦 AWS Pricing Calculator Bulk Template

AWS-only export that generates a CSV matching the EC2 Instances worksheet for the AWS Pricing Calculator Bulk Import. When both recommendation types are generated, **two separate files** are produced (Like-to-Like and Optimized) to prevent double-counting.

### ⚡ Background Data Loading

Instance data (~5 MB per provider) starts loading the moment the page opens. By the time you configure your CSV and options, data is already in memory. If Generate is clicked before loading completes, the request is queued and fires automatically when ready.

---

## 📁 Project Structure

```
Cloud-Instance-Recommender/
├── index.html               # Landing page
├── aws.html                 # AWS recommendations
├── azure.html               # Azure recommendations
├── gcp.html                 # GCP recommendations
├── multicloud.html          # Multi-cloud comparison
├── user-guide.html          # Full user guide (v3.0)
├── user-guide.pdf           # PDF version of the user guide
│
├── css/
│   ├── style.css            # Main application styles
│   └── index_style.css      # Landing page styles
│
├── logos/                   # Cloud provider logos
│
└── js/
    ├── base/
    │   ├── base-instance-selector.js       # Abstract base class
    │   ├── instance-selector-factory.js    # Provider factory + recommendation orchestration
    │   ├── rule-engine.js                  # ENV/OS/Workload/Compliance/MinGen rule logic
    │   ├── optimized_file_handler.js       # CSV parsing and validation
    │   └── main-script.js                  # Application controller
    │
    ├── aws/
    │   ├── aws-instance-selector.js        # AWS-specific logic
    │   ├── aws-specific.js                 # AWS filter UI and sample CSV
    │   └── aws-data.js                     # EC2 instance pricing data (~5 MB)
    │
    ├── azure/
    │   ├── azure-instance-selector.js      # Azure-specific logic
    │   ├── azure-specific.js               # Azure filter UI and sample CSV
    │   └── azure-data.js                   # Azure VM pricing data
    │
    └── gcp/
        ├── gcp-instance-selector.js        # GCP-specific logic
        ├── gcp-specific.js                 # GCP filter UI and sample CSV
        └── gcp-data.js                     # GCP Compute Engine pricing data
```

---

## 🚀 Quick Start

### 1. Access the Application

[https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/](https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/)

Or run locally (no build tools needed):

```bash
git clone https://github.com/harshit-kandhwey/Cloud-Instance-Recommender.git
cd Cloud-Instance-Recommender
python -m http.server 8080
# Open http://localhost:8080
```

### 2. Prepare Your CSV

Download the sample CSV from any provider page and fill in your VM inventory.

**Required columns:**
| Column | Description |
|--------|-------------|
| `VM Name` | Identifier for the VM |
| `CPU Count` | Number of vCPUs |
| `Memory (GB)` | RAM in gigabytes |
| `[Provider] Region` | e.g. `AWS Region`, `Azure Region`, `GCP Region` |

**Optional columns (enable rule-based filtering per row):**
| Column | Values | Effect |
|--------|--------|--------|
| `CPU Utilization` | 0–100 | Drives N/2 / N / N+1 optimization |
| `Memory Utilization` | 0–100 | Drives N/2 / N / N+1 optimization |
| `ENV` | Production / Staging / Dev / Test | Tightens burstable and generation rules |
| `OS` | Linux / Windows / macOS | Affects ARM/Graviton eligibility |
| `Workload` | General / Database / Web Server / Cache / ML/AI / Batch / HPC | Sorts preferred families first |
| `Compliance` | PCI / HIPAA / SOC2 / FIPS | Enforces current-gen; Nitro Enclaves for PCI/HIPAA (AWS) |
| `Min Gen` | AWS: 5/6/7 · Azure: 3/4/5 · GCP: n2/n4 | Minimum instance generation to include |

**Example (multi-cloud):**

```csv
VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region,Azure Region,GCP Region,ENV,OS,Workload,Compliance,Min Gen
web-server-01,4,16,45,60,us-east-1,East US,us-central1-a,Production,Linux,Web Server,,
db-server-02,8,32,70,80,us-west-2,West US 2,us-west1-b,Production,Windows,Database,PCI,
worker-node-07,8,16,85,75,us-west-2,West US 2,us-west1-b,Production,Linux,ML/AI,HIPAA,7
```

### 3. Generate Recommendations

1. Upload your CSV file
2. Select recommendation type (Like-to-Like / Optimized / Both)
3. Configure optimization thresholds (optional)
4. Set Rule Engine defaults in Advanced Filtering (optional)
5. Click **Generate Recommendations**
6. Download the results CSV (and AWS Bulk Template if on the AWS page)

---

## 📊 Output Format

The results CSV contains your original columns plus per-provider recommendation columns:

| Column                                            | Description                                         |
| ------------------------------------------------- | --------------------------------------------------- |
| `AWS Like-to-Like Instance`                       | Recommended EC2 type                                |
| `AWS Like-to-Like vCPUs`                          | vCPU count of recommended instance                  |
| `AWS Like-to-Like Memory (GiB)`                   | Memory of recommended instance                      |
| `AWS Optimized Instance`                          | Optimized EC2 type (if selected)                    |
| `AWS Rules Applied`                               | Which ENV/OS/Workload/Compliance/MinGen rules fired |
| _(Azure and GCP columns follow the same pattern)_ |                                                     |

> **Pricing is intentionally excluded from output.** Cloud pricing depends on region, OS, discounts, Reserved Instances, Savings Plans, and enterprise agreements — a static price in the CSV would be misleading within weeks. Use the provider's pricing calculator with the recommended instance types for authoritative cost figures.

### AWS Bulk Template

Available only on the AWS page. Produces a CSV matching the Amazon EC2 Instances worksheet format for [AWS Pricing Calculator Bulk Import](https://calculator.aws/#/bulk-import). When both L2L and Optimized are generated, two separate files appear — import only one per estimate to avoid double-counting.

---

## 🔧 N/2, N, N+1 Optimization Strategy

Industry-standard thresholds (fully editable in the UI):

| Utilization | CPU action      | Memory action   |
| ----------- | --------------- | --------------- |
| ≤ 40%       | Downsize to N/2 | Downsize to N/2 |
| 40–80%      | Keep same (N)   | Keep same (N)   |
| > 80%       | Upsize to N+1   | Upsize to N+1   |

> AWS, Azure, and GCP cost advisors consistently flag resources with sustained average utilization below 40% as over-provisioned. The 80% upsize trigger aligns with SRE practice of maintaining headroom below 80% peak.

---

## 🔌 API / Programmatic Usage

```javascript
// Create and initialize a provider selector
const awsSelector = InstanceSelectorFactory.createSelector("aws");
await awsSelector.initialize(csvData, regions);

// Like-to-Like
const l2l = awsSelector.getLikeToLikeInstance("us-east-1", 4, 16, options);

// Optimized
const optimized = awsSelector.getOptimizedInstance(
  "us-east-1",
  4,
  16,
  45,
  60,
  options,
);

// Batch — process full CSV across multiple providers
const results = await getInstanceRecommendationWithSelector(
  csvData,
  ["aws", "azure", "gcp"],
  {
    generateLikeToLike: true,
    generateOptimized: true,
    currentGenerationOnly: true,
    ruleDefaultEnv: "Production",
    ruleDefaultWorkload: "Database",
  },
);
```

---

## 🔒 Security & Privacy

- **Client-Side Only** — All processing runs in your browser
- **No Data Transmission** — CSV files never leave your machine
- **No Authentication** — No login, fully anonymous
- **Local Storage** — Only usage statistics are stored locally

---

## 🛠️ Architecture

The application uses a modular, class-based architecture:

- **`BaseInstanceSelector`** — Abstract base with common region loading, data parsing, and filtering
- **`AWSInstanceSelector` / `AzureInstanceSelector` / `GCPInstanceSelector`** — Provider-specific field mappings, region normalization, and generation detection
- **`RuleEngine`** — Pure function that applies ENV/OS/Workload/Compliance/MinGen rules to the filtered candidate list
- **`InstanceSelectorFactory`** — Creates the right selector per provider and orchestrates per-row processing
- **`main-script.js`** — Application controller: file handling, UI events, download generation

---

## 📄 License

Proprietary software — all rights reserved by Harshit Kandhwey.

The application is available for public use and demonstration. Source code is provided for transparency. Copying, modification, or redistribution without explicit permission is not permitted.

## 📞 Contact & Support

- **Live Demo**: [https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/](https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/)
- **User Guide**: See `user-guide.html` (or `user-guide.pdf`) in this repository
- **Bugs / Requests**: Open an issue on GitHub
- **Email**: harshitkandhwey@gmail.com

---

_Made with ❤️ for cloud infrastructure optimization_
