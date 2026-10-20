@description('Region for the Microsoft Foundry resource and project.')
param location string

@description('Globally unique Microsoft Foundry resource name.')
param accountName string

@description('Microsoft Foundry project name.')
param projectName string

@description('Storage account resource ID. The Foundry managed identity receives read-only blob access for future URL-based video analysis.')
param storageAccountId string

@description('Storage account name, used to scope the read-only role assignment.')
param storageAccountName string

@description('Resource tags.')
param tags object

@description('Optional Microsoft Entra object ID for local model inference and Foundry project development.')
param developerPrincipalId string = ''

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: accountName
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  tags: tags
  properties: {
    allowProjectManagement: true
    customSubDomainName: accountName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    restrictOutboundNetworkAccess: false
  }
}

resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: foundryAccount
  name: projectName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  tags: tags
  properties: {
    displayName: projectName
    description: 'FanPulse football video analysis and agent orchestration project.'
  }
}

// Cloud evaluations invoke the judge deployment as the project's managed
// identity. Project-scoped access alone does not authorize model inference.
resource projectFoundryUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, foundryProject.id, 'Foundry User')
  scope: foundryAccount
  properties: {
    principalId: foundryProject.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '53ca6127-db72-4b80-b1b0-d745d6d5456d')
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource foundryStorageBlobReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccountId, foundryAccount.id, 'Storage Blob Data Reader')
  scope: storageAccount
  properties: {
    principalId: foundryAccount.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')
  }
}

resource developerOpenAIUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(developerPrincipalId)) {
  name: guid(foundryAccount.id, developerPrincipalId, 'Cognitive Services OpenAI User')
  scope: foundryAccount
  properties: {
    principalId: developerPrincipalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  }
}

resource developerFoundryUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(developerPrincipalId)) {
  name: guid(foundryProject.id, developerPrincipalId, 'Foundry User')
  scope: foundryProject
  properties: {
    principalId: developerPrincipalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '53ca6127-db72-4b80-b1b0-d745d6d5456d')
  }
}

output accountName string = foundryAccount.name
output projectName string = foundryProject.name
output endpoint string = foundryAccount.properties.endpoint
output projectEndpoint string = 'https://${accountName}.services.ai.azure.com/api/projects/${projectName}'
output projectResourceId string = foundryProject.id
output projectPrincipalId string = foundryProject.identity.principalId
