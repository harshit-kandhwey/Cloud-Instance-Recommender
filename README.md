# 🌐 Cloud Instance Recommender

This is a **static web application** hosted on GitHub Pages that allows users to upload CSV files containing infrastructure data and receive optimal cloud instance recommendations for **AWS**, **Azure**, and **GCP** — directly in their browser.

> 🛑 This project is not intended for cloning or downloading. It runs entirely in the browser, with no backend or server interaction.

---

## 🚀 Features

- 📁 **CSV Upload & Validation**
  - Drag and drop or file selection
  - Validates headers and rows with clear error messages

- ⚙️ **Instance Recommendation Engine**
  - Like-to-Like or Optimized recommendations
  - Supports downsizing strategies (e.g., N-1, N/2)
  - Based on CPU and Memory utilization

- ☁️ **Multi-Cloud Support**
  - Generate recommendations for AWS, Azure, and GCP simultaneously
  - Provider-specific region, instance types, and pricing logic

- 📊 **Data Preview & Stats**
  - View the first 5 rows
  - File metadata and quality score display

- 📤 **Export Processed Data**
  - Download the cleaned and processed CSV with recommendations

---

## 📂 Project Structure (Internal)

```bash
.
├── index.html                # Main webpage
├── style.css                 # Styling for the UI
├── script.js                 # UI controls and interaction logic
├── file_handler_combined.js  # Refactored file handling logic
├── sample.csv                # Example CSV format
└── README.md                 # Project overview
```

---

## 🧪 Sample CSV Format
```csv
VM Name,CPU Count,Memory (GB),CPU Utilization,Memory Utilization,AWS Region,Azure Region,GCP Region
web-server-01,4,16,45,60,us-east-1,East US,us-central1-a
db-server-02,8,32,70,80,us-west-2,West US 2,us-west1-b
app-server-03,2,8,35,45,eu-west-1,North Europe,europe-west1-c
```

---

## 🛠️ Usage

1. Visit the website on GitHub Pages
2. Upload your CSV file via the upload section
3. View recommendations and download results if desired

> ⚠️ All processing is done client-side. No data is uploaded to any server.

---


## 📃 License

This application is publicly accessible but not available for download or redistribution. All rights reserved by the project maintainers.
