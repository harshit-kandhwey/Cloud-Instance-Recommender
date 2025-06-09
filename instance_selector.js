// Instance Selection Engine for Cloud Instance Recommender
// Handles loading instance data and finding optimal matches

class InstanceSelector {
  constructor() {
    this.instanceData = {
      aws: {},
      azure: {},
      gcp: {}
    };
    this.loadedRegions = new Set();
    this.isInitialized = false;
    
    // Instance families to exclude (Graviton, etc.)
    this.excludedFamilies = {
      aws: ['a1', 't4g', 'm6g', 'm6gd', 'c6g', 'c6gd', 'c6gn', 'r6g', 'r6gd', 'x2gd', 'g5g', 'im4gn', 'is4gen', 'i4g'],
      azure: [],
      gcp: []
    };
    
    // Column mappings for different cloud providers
    this.columnMappings = {
      aws: {
        instanceType: 'instanceType',
        vCpus: 'vCpus',
        memory: 'memorySizeInGiB',
        price: 'onDemandLinuxHr',
        family: 'instanceFamily',
        location: 'location'
      },
      azure: {
        instanceType: 'vmSize',
        vCpus: 'vCpus',
        memory: 'memoryGiB',
        price: 'linuxPrice',
        family: 'family',
        location: 'location'
      },
      gcp: {
        instanceType: 'machineType',
        vCpus: 'vCpus',
        memory: 'memoryGiB',
        price: 'hourlyPrice',
        family: 'series',
        location: 'zone'
      }
    };
  }

  // Initialize the selector with required data
  async initialize(csvData, selectedProviders) {
    this.isInitialized = false;
    
    // Extract unique regions from CSV data
    const regions = this.extractUniqueRegions(csvData, selectedProviders);
    
    // Load instance data for each region
    await this.loadInstanceData(regions, selectedProviders);
    
    this.isInitialized = true;
  }

  // Extract unique regions from the CSV data
  extractUniqueRegions(csvData, selectedProviders) {
    const regions = {
      aws: new Set(),
      azure: new Set(),
      gcp: new Set()
    };

    const regionColumns = {
      aws: 'AWS Region',
      azure: 'Azure Region',
      gcp: 'GCP Region'
    };

    csvData.forEach(row => {
      selectedProviders.forEach(provider => {
        const region = row[regionColumns[provider]];
        if (region && region.trim()) {
          regions[provider].add(region.trim());
        }
      });
    });

    return regions;
  }

  // Load instance data from CSV files
  async loadInstanceData(regions, selectedProviders) {
    const loadPromises = [];

    selectedProviders.forEach(provider => {
      regions[provider].forEach(region => {
        if (!this.loadedRegions.has(`${provider}-${region}`)) {
          loadPromises.push(this.loadRegionData(provider, region));
        }
      });
    });

    await Promise.all(loadPromises);
  }

  // Load data for a specific region
  async loadRegionData(provider, region) {
    try {
      // Construct file path based on provider and region
      const fileName = `${region}.csv`;
      const filePath = `${provider.toUpperCase()}/${fileName}`;
      
      // In a real implementation, this would fetch from a server
      // For now, we'll simulate with sample data
      const data = await this.fetchInstanceData(filePath);
      
      if (!this.instanceData[provider][region]) {
        this.instanceData[provider][region] = [];
      }
      
      // Parse and store the data
      this.instanceData[provider][region] = this.parseInstanceData(data, provider);
      this.loadedRegions.add(`${provider}-${region}`);
      
    } catch (error) {
      console.error(`Failed to load data for ${provider} ${region}:`, error);
      // Use fallback sample data
      this.instanceData[provider][region] = this.getFallbackData(provider, region);
    }
  }

  // Simulate fetching instance data (replace with actual fetch in production)
  async fetchInstanceData(filePath) {
    // In production, this would be:
    // const response = await fetch(`/data/${filePath}`);
    // return await response.text();
    
    // For now, return sample data based on the file path
    if (filePath.includes('aws/us-east-1')) {
      return this.getAwsSampleData();
    } else if (filePath.includes('azure/East US')) {
      return this.getAzureSampleData();
    } else if (filePath.includes('gcp/us-central1')) {
      return this.getGcpSampleData();
    }
    
    return '';
  }

  // Parse CSV data into structured format
  parseInstanceData(csvText, provider) {
    if (!csvText) return [];
    
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const mapping = this.columnMappings[provider];
    
    const instances = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      const instance = {};
      
      headers.forEach((header, index) => {
        instance[header] = values[index] || '';
      });
      
      // Standardize the data structure
      const standardized = {
        instanceType: instance[mapping.instanceType],
        vCpus: parseInt(instance[mapping.vCpus]) || 0,
        memory: parseFloat(instance[mapping.memory]) || 0,
        price: parseFloat(instance[mapping.price]) || 0,
        family: instance[mapping.family] || '',
        location: instance[mapping.location] || '',
        originalData: instance
      };
      
      // Filter out excluded families
      if (!this.isExcludedFamily(standardized.instanceType, provider)) {
        instances.push(standardized);
      }
    }
    
    // Sort by price for efficient selection
    instances.sort((a, b) => a.price - b.price);
    
    return instances;
  }

  // Parse a CSV line handling quoted values
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  // Check if instance type belongs to excluded family
  isExcludedFamily(instanceType, provider) {
    const excluded = this.excludedFamilies[provider] || [];
    return excluded.some(family => instanceType.toLowerCase().startsWith(family));
  }

  // Get like-to-like instance recommendation
  getLikeToLikeInstance(provider, region, currentCpu, currentMemory, options = {}) {
    const regionData = this.instanceData[provider][region];
    if (!regionData || regionData.length === 0) {
      return {
        instanceType: 'No data available',
        vCpus: 0,
        memory: 0,
        price: 0,
        reason: 'Region data not loaded'
      };
    }

    // Apply filters based on options
    let filteredInstances = regionData.filter(instance => {
      // Must meet or exceed CPU and Memory requirements
      if (instance.vCpus < currentCpu || instance.memory < currentMemory) {
        return false;
      }
      
      // Apply family restrictions if specified
      if (options.restrictToFamilies && options.restrictToFamilies.length > 0) {
        const instanceFamily = this.getInstanceFamily(instance.instanceType, provider);
        if (!options.restrictToFamilies.includes(instanceFamily)) {
          return false;
        }
      }
      
      // Apply type exclusions if specified
      if (options.excludeTypes && options.excludeTypes.length > 0) {
        if (options.excludeTypes.some(type => instance.instanceType.includes(type))) {
          return false;
        }
      }
      
      return true;
    });

    if (filteredInstances.length === 0) {
      return {
        instanceType: 'No suitable match',
        vCpus: 0,
        memory: 0,
        price: 0,
        reason: 'No instances meet requirements'
      };
    }

    // Find the cheapest instance that meets requirements
    const bestInstance = filteredInstances.reduce((cheapest, current) => {
      return current.price < cheapest.price ? current : cheapest;
    });

    return {
      instanceType: bestInstance.instanceType,
      vCpus: bestInstance.vCpus,
      memory: bestInstance.memory,
      price: bestInstance.price,
      monthlyPrice: (bestInstance.price * 730).toFixed(2),
      reason: `Selected based on >=CPU (${currentCpu}) and >=Memory (${currentMemory}GB) - cheapest match`
    };
  }

  // Get optimized instance recommendation based on utilization
  getOptimizedInstance(provider, region, currentCpu, currentMemory, cpuUtil, memoryUtil, options = {}) {
    // Calculate target specs based on utilization and optimization settings
    let targetCpu = currentCpu;
    let targetMemory = currentMemory;
    
    if (options.cpuBased && cpuUtil > 0) {
      if (cpuUtil <= options.cpuDownsizeMax) {
        // Downsize CPU
        targetCpu = options.downsizingStrategy === 'half' 
          ? Math.max(1, Math.ceil(currentCpu * 0.5))
          : Math.max(1, currentCpu - 1);
      } else if (cpuUtil > options.cpuUpsizeMin) {
        // Upsize CPU
        targetCpu = Math.ceil(currentCpu * 1.5);
      }
    }
    
    if (options.memoryBased && memoryUtil > 0) {
      if (memoryUtil <= options.memoryDownsizeMax) {
        // Downsize Memory
        targetMemory = options.downsizingStrategy === 'half'
          ? Math.max(1, Math.ceil(currentMemory * 0.5))
          : Math.max(1, currentMemory - 1);
      } else if (memoryUtil > options.memoryUpsizeMin) {
        // Upsize Memory
        targetMemory = Math.ceil(currentMemory * 1.5);
      }
    }
    
    // Get instance based on optimized requirements
    const result = this.getLikeToLikeInstance(provider, region, targetCpu, targetMemory, options);
    result.reason = `Optimized from ${currentCpu}vCPU/${currentMemory}GB to ${targetCpu}vCPU/${targetMemory}GB based on utilization`;
    
    return result;
  }

  // Get instance family from instance type
  getInstanceFamily(instanceType, provider) {
    if (provider === 'aws') {
      // AWS: t3.large -> t3
      const match = instanceType.match(/^([a-z]+\d+[a-z]*)/);
      return match ? match[1] : '';
    } else if (provider === 'azure') {
      // Azure: Standard_D2s_v3 -> Standard_D
      const match = instanceType.match(/^(Standard_[A-Z]+)/);
      return match ? match[1] : '';
    } else if (provider === 'gcp') {
      // GCP: n1-standard-1 -> n1
      const match = instanceType.match(/^([a-z]+\d*)/);
      return match ? match[1] : '';
    }
    return '';
  }

  // Get fallback data when actual data can't be loaded
  getFallbackData(provider, region) {
    const fallbackData = {
      aws: [
        { instanceType: 't3.nano', vCpus: 1, memory: 0.5, price: 0.0052, family: 't3' },
        { instanceType: 't3.micro', vCpus: 2, memory: 1, price: 0.0104, family: 't3' },
        { instanceType: 't3.small', vCpus: 2, memory: 2, price: 0.0208, family: 't3' },
        { instanceType: 't3.medium', vCpus: 2, memory: 4, price: 0.0416, family: 't3' },
        { instanceType: 't3.large', vCpus: 2, memory: 8, price: 0.0832, family: 't3' },
        { instanceType: 'm5.large', vCpus: 2, memory: 8, price: 0.096, family: 'm5' },
        { instanceType: 'm5.xlarge', vCpus: 4, memory: 16, price: 0.192, family: 'm5' },
        { instanceType: 'c5.large', vCpus: 2, memory: 4, price: 0.085, family: 'c5' },
        { instanceType: 'c5.xlarge', vCpus: 4, memory: 8, price: 0.17, family: 'c5' }
      ],
      azure: [
        { instanceType: 'Standard_B1s', vCpus: 1, memory: 1, price: 0.0104, family: 'Standard_B' },
        { instanceType: 'Standard_B2s', vCpus: 2, memory: 4, price: 0.0416, family: 'Standard_B' },
        { instanceType: 'Standard_D2s_v3', vCpus: 2, memory: 8, price: 0.096, family: 'Standard_D' },
        { instanceType: 'Standard_D4s_v3', vCpus: 4, memory: 16, price: 0.192, family: 'Standard_D' }
      ],
      gcp: [
        { instanceType: 'e2-micro', vCpus: 1, memory: 1, price: 0.0063, family: 'e2' },
        { instanceType: 'e2-small', vCpus: 1, memory: 2, price: 0.0126, family: 'e2' },
        { instanceType: 'e2-medium', vCpus: 1, memory: 4, price: 0.0252, family: 'e2' },
        { instanceType: 'n1-standard-1', vCpus: 1, memory: 3.75, price: 0.0475, family: 'n1' },
        { instanceType: 'n1-standard-2', vCpus: 2, memory: 7.5, price: 0.095, family: 'n1' }
      ]
    };
    
    return fallbackData[provider] || [];
  }

  // Sample data generators for testing
  getAwsSampleData() {
    return `instanceType,instanceFamily,instanceFamilyName,location,currentGeneration,processorManufacturer,vCpus,memorySizeInGiB,onDemandLinuxHr,onDemandWindowsHr,reserved3yNoUpfrontLinuxHr,reserved3yNoUpfrontWindowsHr
t3.nano,t,General purpose,us-east-1,1,Intel,1,0.5,0.0052,0.0162,0.0031,0.0141
t3.micro,t,General purpose,us-east-1,1,Intel,2,1,0.0104,0.0324,0.0062,0.0282
t3.small,t,General purpose,us-east-1,1,Intel,2,2,0.0208,0.0648,0.0124,0.0564
t3.medium,t,General purpose,us-east-1,1,Intel,2,4,0.0416,0.1296,0.0248,0.1128
t3.large,t,General purpose,us-east-1,1,Intel,2,8,0.0832,0.2592,0.0496,0.2256
m5.large,m,General purpose,us-east-1,1,Intel,2,8,0.096,0.288,0.057,0.249
m5.xlarge,m,General purpose,us-east-1,1,Intel,4,16,0.192,0.576,0.114,0.498
c5.large,c,Compute optimized,us-east-1,1,Intel,2,4,0.085,0.269,0.051,0.235
c5.xlarge,c,Compute optimized,us-east-1,1,Intel,4,8,0.17,0.538,0.102,0.47`;
  }

  getAzureSampleData() {
    return `vmSize,vCpus,memoryGiB,family,location,linuxPrice,windowsPrice
Standard_B1s,1,1,Standard_B,East US,0.0104,0.0208
Standard_B2s,2,4,Standard_B,East US,0.0416,0.0832
Standard_D2s_v3,2,8,Standard_D,East US,0.096,0.192
Standard_D4s_v3,4,16,Standard_D,East US,0.192,0.384`;
  }

  getGcpSampleData() {
    return `machineType,series,vCpus,memoryGiB,zone,hourlyPrice
e2-micro,e2,1,1,us-central1-a,0.0063
e2-small,e2,1,2,us-central1-a,0.0126
e2-medium,e2,1,4,us-central1-a,0.0252
n1-standard-1,n1,1,3.75,us-central1-a,0.0475
n1-standard-2,n1,2,7.5,us-central1-a,0.095`;
  }
}

// Export the instance selector
window.InstanceSelector = InstanceSelector;

// Integration function for the main script
window.getInstanceRecommendationWithSelector = async function(csvData, selectedProviders, options) {
  const selector = new InstanceSelector();
  
  // Initialize with CSV data
  await selector.initialize(csvData, selectedProviders);
  
  // Process each row
  const results = csvData.map(row => {
    const result = { ...row };
    
    selectedProviders.forEach(provider => {
      const cpu = parseInt(row['CPU Count']) || 0;
      const memory = parseFloat(row['Memory (GB)']) || 0;
      const cpuUtil = parseFloat(row['CPU Utilization']) || 0;
      const memoryUtil = parseFloat(row['Memory Utilization']) || 0;
      const region = row[`${provider.toUpperCase()} Region`] || '';
      
      if (!region || cpu === 0 || memory === 0) {
        result[`${provider.toUpperCase()} Like-to-Like`] = 'Missing data';
        result[`${provider.toUpperCase()} Optimized`] = 'Missing data';
        return;
      }
      
      // Get like-to-like recommendation
      const likeToLike = selector.getLikeToLikeInstance(provider, region, cpu, memory, options);
      result[`${provider.toUpperCase()} Like-to-Like`] = likeToLike.instanceType;
      result[`${provider.toUpperCase()} Like-to-Like Price`] = likeToLike.monthlyPrice;
      
      // Get optimized recommendation if utilization data available
      if (cpuUtil > 0 || memoryUtil > 0) {
        const optimized = selector.getOptimizedInstance(provider, region, cpu, memory, cpuUtil, memoryUtil, options);
        result[`${provider.toUpperCase()} Optimized`] = optimized.instanceType;
        result[`${provider.toUpperCase()} Optimized Price`] = optimized.monthlyPrice;
      } else {
        result[`${provider.toUpperCase()} Optimized`] = 'No utilization data';
        result[`${provider.toUpperCase()} Optimized Price`] = 'N/A';
      }
    });
    
    return result;
  });
  
  return results;
};
