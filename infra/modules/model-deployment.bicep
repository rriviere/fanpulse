@description('Existing Microsoft Foundry account name.')
param accountName string

@description('Model deployment name consumed by application code.')
param deploymentName string

@description('Foundry model identifier verified against the target account.')
param modelName string

@description('Pinned Foundry model version.')
param modelVersion string

@allowed([
  'GlobalStandard'
  'DataZoneStandard'
  'Standard'
])
@description('Consumption deployment SKU. No provisioned throughput is used.')
param skuName string

@minValue(1)
@description('Thousands of tokens per minute allocated from the subscription quota.')
param capacity int

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: accountName
}

resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundryAccount
  name: deploymentName
  sku: {
    name: skuName
    capacity: capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

output deploymentName string = deployment.name
