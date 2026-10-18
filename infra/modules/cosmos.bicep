@description('Azure region for the single-region Cosmos DB account.')
param location string

@description('Globally unique Cosmos DB account name.')
param accountName string

@description('Cosmos DB database name.')
param databaseName string = 'fanpulse'

@description('Cosmos DB container name.')
param containerName string = 'activity'

@description('Resource tags.')
param tags object

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  tags: tags
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    disableLocalAuth: true
    enableAutomaticFailover: false
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: 'Enabled'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: account
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: containerName
  properties: {
    resource: {
      id: containerName
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          { path: '/type/?' }
          { path: '/session_id/?' }
          { path: '/created_at/?' }
          { path: '/poll_id/?' }
          { path: '/option_id/?' }
        ]
        excludedPaths: [
          { path: '/*' }
        ]
      }
      partitionKey: {
        paths: [
          '/partition_key'
        ]
        kind: 'Hash'
        version: 2
      }
    }
  }
}

output accountId string = account.id
output accountName string = account.name
output endpoint string = account.properties.documentEndpoint
output databaseName string = database.name
output containerName string = container.name
