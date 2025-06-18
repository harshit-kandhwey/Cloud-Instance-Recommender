# 🌐 Cloud Instance Recommender

A comprehensive web-based tool for generating optimal cloud instance recommendations across AWS, Azure, and Google Cloud Platform (GCP). This tool helps organizations optimize their cloud infrastructure costs by providing intelligent instance sizing recommendations based on current usage patterns and utilization data.

![Cloud Instance Recommender](https://img.shields.io/badge/Cloud-Instance%20Recommender-blue)
![Version](https://img.shields.io/badge/Version-1.0.0-green)
![License](https://img.shields.io/badge/License-Proprietary-red)

> **🌐 Live Demo**: Experience the application at its official deployment URL. This proprietary tool is available for public demonstration and evaluation.

## 🚀 Features

### 📊 **Multi-Cloud Support**

- **AWS**: EC2 instance recommendations with Graviton support
- **Azure**: Virtual Machine sizing with ARM-based instances
- **GCP**: Compute Engine optimization with T2A instances
- **Multi-Cloud**: Side-by-side provider comparison

### 🎯 **Recommendation Types**

- **Like-to-Like**: Find cheapest instances that meet or exceed current specs
- **Optimized**: Smart recommendations based on actual CPU/memory utilization
- **N/2, N, N+1 Strategy**: Intelligent scaling based on utilization patterns

### 🔧 **Advanced Filtering**

- **Generation Filtering**: Current vs. previous generation instances
- **Processor Types**: Intel, AMD, ARM/Graviton support
- **Instance Families**: Compute, memory, storage optimized
- **Cost Optimization**: Exclude/include specific instance types

### 📈 **Analytics & Insights**

- Usage statistics and processing counters
- Data quality scoring and validation
- Cost savings analysis
- Performance recommendations

## 🏗️ Architecture

### **Modular Design**

The application uses a modular, object-oriented architecture with provider-specific implementations:

```
├── Base Classes
│   ├── BaseInstanceSelector          # Common functionality
│   ├── FileHandler                   # CSV processing
│   └── IntegrationManager           # System orchestration
│
├── Provider Implementations
│   ├── AWSInstanceSelector          # AWS-specific logic
│   ├── AzureInstanceSelector        # Azure-specific logic
│   └── GCPInstanceSelector          # GCP-specific logic
│
├── UI Components
│   ├── aws-specific.js              # AWS filtering UI
│   ├── azure-specific.js            # Azure filtering UI
│   └── gcp-specific.js              # GCP filtering UI
│
└── Integration Layer
    ├── instance-selector-factory.js # Provider factory
    └── main-script.js               # Application controller
```

### **Key Components**

#### **BaseInstanceSelector**

- Abstract base class providing common functionality
- Standardized data processing and filtering
- Extensible architecture for new cloud providers

#### **Provider-Specific Selectors**

- **AWS**: Graviton detection, Nitro support, comprehensive family filtering
- **Azure**: ARM instance support, VM series categorization
- **GCP**: T2A ARM instances, machine type categorization

#### **FileHandler System**

- Optimized CSV parsing with error handling
- Data validation and quality scoring
- Drag-and-drop file upload support

## 📁 Project Structure

```
cloud-instance-recommender/
│
├── 📄 LICENSE                  # Proprietary software license
├── 📄 README.md               # Project documentation
│
├── 📄 HTML Pages
│   ├── index.html              # Landing page
│   ├── aws.html               # AWS recommendations
│   ├── azure.html             # Azure recommendations
│   ├── gcp.html               # GCP recommendations
│   └── multicloud.html        # Multi-cloud comparison
│
├── 🎨 Styling
│   ├── css/
│   │   ├── style.css          # Main application styles
│   │   └── index_style.css    # Landing page styles
│   └── logos/                 # Cloud provider logos
│       ├── aws-logo.png
│       ├── azure-logo.png
│       ├── gcp-logo.png
│       └── multicloud-logo.png
│
└── 🧠 Core JavaScript
    ├── js/base/
    │   ├── base-instance-selector.js
    │   ├── instance-selector-factory.js
    │   ├── optimized_file_handler.js
    │   └── main-script.js
    │
    ├── js/aws/
    │   ├── aws-instance-selector.js
    │   ├── aws-specific.js
    │   └── aws-data.js
    │
    ├── js/azure/
    │   ├── azure-instance-selector.js
    │   ├── azure-specific.js
    │   └── azure-data.js
    │
    └── js/gcp/
        ├── gcp-instance-selector.js
        ├── gcp-specific.js
        └── gcp-data.js
```

## 🚀 Quick Start

### **1. Access the Application**

Visit the live application at the official deployment URL to begin using the Cloud Instance Recommender.

### **2. For Local Development (Authorized Users)**

If you have received explicit permission for local development:

```bash
# Serve the files using any web server
# Python 3
python -m http.server 8000

# Node.js
npx serve .

# PHP
php -S localhost:8000
```

### **3. Begin Analysis**

1. Navigate to your preferred cloud provider section
2. Download and customize the CSV template
3. Upload your VM inventory data
4. Configure optimization settings
5. Generate and download recommendations

## 📊 Usage Guide

### **Step 1: Prepare Your Data**

Create a CSV file with your current VM inventory:

```csv
VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region,Azure Region,GCP Region
web-server-01,4,16,45,60,us-east-1,East US,us-central1-a
db-server-02,8,32,70,80,us-west-2,West US 2,us-west1-b
app-server-03,2,8,35,45,eu-west-1,North Europe,europe-west1-c
```

**Required Columns:**

- `VM Name`: Identifier for your virtual machine
- `CPU Count`: Number of vCPUs
- `Memory (GB)`: RAM in gigabytes

**Optional Columns:**

- `CPU Utilization`: Average CPU usage percentage
- `Memory Utilization`: Average memory usage percentage
- `[Provider] Region`: Target region for recommendations

### **Step 2: Upload and Configure**

1. **Choose Provider**: Select AWS, Azure, GCP, or Multi-Cloud
2. **Upload CSV**: Drag and drop or select your CSV file
3. **Set Recommendation Type**:
   - **Like-to-Like**: Cheapest instances meeting current specs
   - **Optimized**: Based on utilization data
   - **Both**: Generate both recommendation types

### **Step 3: Advanced Configuration**

#### **Optimization Settings** (for Optimized recommendations)

- **CPU Thresholds**:

  - Downsize if utilization ≤ 50%
  - Keep same if 50% < utilization ≤ 80%
  - Upsize if utilization > 80%

- **Memory Thresholds**:
  - Downsize if utilization ≤ 50%
  - Keep same if 50% < utilization ≤ 80%
  - Upsize if utilization > 80%

#### **Filtering Options**

- **Current Generation Only**: Latest instance types
- **Processor Preferences**: Intel, AMD, ARM/Graviton
- **Instance Families**: General purpose, compute optimized, memory optimized
- **Exclude Types**: Specific categories to avoid

### **Step 4: Generate and Download**

1. Click "Generate Recommendations"
2. Review processing status and statistics
3. Download results as CSV with recommendations

## 🔧 Configuration Options

### **Recommendation Strategies**

#### **Like-to-Like Strategy**

```javascript
// Finds the cheapest instance that meets or exceeds:
const requirements = {
  minCpu: currentCpuCount,
  minMemory: currentMemoryGB,
  filters: advancedFilters,
};
```

#### **N/2, N, N+1 Optimization Strategy**

```javascript
const optimizationRules = {
  // CPU Rules
  cpuDownsize: utilization <= 50, // N/2 (half current)
  cpuKeepSame: 50 < utilization <= 80, // N (same)
  cpuUpsize: utilization > 80, // N+1 (add one)

  // Memory Rules
  memoryDownsize: utilization <= 50,
  memoryKeepSame: 50 < utilization <= 80,
  memoryUpsize: utilization > 80,
};
```

### **Provider-Specific Features**

#### **AWS**

```javascript
const awsOptions = {
  currentGenerationOnly: true,
  excludeGraviton: false, // Include ARM instances
  restrictMainFamilies: ["m", "c", "r"], // Instance families
  nitroSupport: true, // Latest networking
};
```

#### **Azure**

```javascript
const azureOptions = {
  restrictVMSeries: ["Dv3", "Ev3"], // VM series
  excludeARM: false, // Include ARM instances
  pricingTier: "Standard", // Pricing tier
};
```

#### **GCP**

```javascript
const gcpOptions = {
  restrictMachineSeries: ["n2", "c2"], // Machine series
  excludePreemptible: true, // Exclude spot instances
  customMachineTypes: false, // Standard types only
};
```

## 📈 Output Format

The tool generates enhanced CSV files with recommendations:

```csv
VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,
AWS Like-to-Like Instance,AWS Like-to-Like Price,AWS Like-to-Like vCPUs,AWS Like-to-Like Memory,
AWS Optimized Instance,AWS Optimized Price,AWS Optimized vCPUs,AWS Optimized Memory,
Azure Like-to-Like Instance,Azure Like-to-Like Price,...
```

### **Output Columns Explained**

- **Instance Type**: Recommended instance (e.g., m5.large, Standard_D2s_v3)
- **Price**: Hourly cost in USD
- **vCPUs**: Number of virtual CPUs
- **Memory**: RAM in GB
- **Reasoning**: Why this instance was selected

## 🎯 Advanced Features

### **Data Validation**

- **Quality Scoring**: Automatic data quality assessment (0-100%)
- **Error Detection**: Missing values, invalid formats, duplicates
- **Recommendations**: Suggestions for data improvement

### **Filtering Engine**

- **Current Generation**: Latest instance types only
- **Processor Architecture**: Intel, AMD, ARM support
- **Performance Tiers**: Burstable, standard, high-performance
- **Cost Optimization**: Budget-aware recommendations

### **Multi-Cloud Comparison**

- **Side-by-Side**: Compare providers for each workload
- **Cost Analysis**: Price differences across clouds
- **Feature Mapping**: Equivalent instance types

## 🔌 API Integration

### **Programmatic Usage**

```javascript
// Create provider-specific selector
const awsSelector = InstanceSelectorFactory.createSelector("aws");
await awsSelector.initialize(csvData, regions);

// Get recommendations
const likeToLike = awsSelector.getLikeToLikeInstance(
  "us-east-1",
  4,
  16,
  options
);

const optimized = awsSelector.getOptimizedInstance(
  "us-east-1",
  4,
  16,
  45,
  60,
  options
);
```

### **Batch Processing**

```javascript
// Process entire CSV with multiple providers
const results = await getInstanceRecommendationWithSelector(
  csvData,
  ["aws", "azure", "gcp"],
  {
    generateLikeToLike: true,
    generateOptimized: true,
    currentGenerationOnly: true,
  }
);
```

## 🛠️ Architecture & Customization

### **Extending Functionality** (For Authorized Developers)

For those with appropriate licensing permissions, the modular architecture supports extensions:

#### **Adding New Providers**

1. **Create Provider Selector**:

```javascript
class NewProviderSelector extends BaseInstanceSelector {
  getProviderName() { return "NewProvider"; }
  getFieldMappings() { return {...}; }
  getSampleData() { return [...]; }
}
```

2. **Register in Factory**:

```javascript
// Update instance-selector-factory.js
case 'newprovider':
  return new NewProviderSelector();
```

3. **Create UI Components**:

```javascript
// newprovider-specific.js
function initializeNewProviderFilters() {
  // Provider-specific filtering UI
}
```

#### **Custom Optimization Strategies** (Licensed Use)

```javascript
class CustomOptimizationStrategy extends BaseInstanceSelector {
  getOptimizedInstance(region, cpu, memory, cpuUtil, memUtil, options) {
    // Custom optimization logic for licensed implementations
    return this.applyCustomStrategy(cpu, memory, cpuUtil, memUtil);
  }
}
```

## 📋 CSV Template

Download sample CSV templates from the application:

### **Single Provider**

```csv
VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region
web-server-01,4,16,45,60,us-east-1
```

### **Multi-Cloud**

```csv
VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region,Azure Region,GCP Region
web-server-01,4,16,45,60,us-east-1,East US,us-central1-a
```

## 🐛 Troubleshooting

### **Common Issues**

#### **CSV Upload Failures**

```
Error: "CSV parsing failed"
Solution: Ensure proper CSV format, check for special characters
```

#### **Missing Recommendations**

```
Error: "No instances meet filtering criteria"
Solution: Relax filtering options or check region availability
```

#### **Performance Issues**

```
Issue: Slow processing with large files
Solution: Files >1000 rows may take longer, consider splitting
```

### **Data Quality Issues**

- **Missing Values**: Tool handles gracefully with warnings
- **Invalid Formats**: Automatic data cleaning and validation
- **Duplicate Headers**: Error detection with specific guidance

## 🔒 Security & Privacy

- **Client-Side Processing**: All data processing happens in your browser
- **No Data Transmission**: CSV files are not uploaded to external servers
- **Local Storage**: Usage statistics stored locally only
- **No Authentication**: No login required, fully anonymous

## 🧑‍💻 Technical Overview

### **Code Architecture**

- **JavaScript**: ES6+ with modular design patterns
- **CSS**: BEM methodology for maintainable styling
- **HTML**: Semantic markup with accessibility features
- **Documentation**: Comprehensive inline documentation

### **Demo Functions**

The application includes built-in demonstration functions for testing:

```javascript
// Available demo functions for exploration
demonstrateInstanceSelector();
demonstrateAWSSelector();
demonstrateRecommendationTypes();
```

## 📄 License

This project is proprietary software protected by copyright. All rights reserved by Harshit Kandhwey.

**Usage Rights**: This application is available for public viewing and demonstration purposes. For licensing inquiries, usage permissions, or collaboration opportunities, please contact the author directly.

**Source Code**: The code is provided for transparency and educational understanding but may not be copied, modified, or redistributed without explicit permission.

## 🙏 Acknowledgments

- **Cloud Providers**: AWS, Microsoft Azure, Google Cloud Platform for their comprehensive documentation
- **Technology Stack**: Modern web technologies enabling client-side processing
- **AI Assistance**: This project was developed with AI assistance under human creative direction and control

## 📞 Support & Contact

- **Live Demo**: Experience the application through its official deployment
- **Documentation**: Comprehensive guides and technical documentation provided
- **Feedback**: Questions and suggestions welcome through official channels
- **Licensing**: Contact for usage rights, partnerships, or collaboration opportunities

For inquiries regarding licensing, commercial use, or technical collaboration, please reach out to the author directly.

---

**Made with ❤️ for cloud infrastructure optimization**
