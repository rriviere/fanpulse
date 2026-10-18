@description('Region for the storage account.')
param location string

@description('Globally unique storage account name.')
param storageAccountName string

@description('Resource tags.')
param tags object

@description('Optional Entra object ID to grant Storage Blob Data Contributor. No access is assigned when empty.')
param developerPrincipalId string = ''

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource footballVideos 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'football-videos'
  properties: {
    publicAccess: 'None'
  }
}

resource developerBlobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(developerPrincipalId)) {
  name: guid(storageAccount.id, developerPrincipalId, 'Storage Blob Data Contributor')
  scope: storageAccount
  properties: {
    principalId: developerPrincipalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}

output id string = storageAccount.id
output name string = storageAccount.name
output containerName string = footballVideos.name
