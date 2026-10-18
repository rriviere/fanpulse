@description('Existing Cosmos DB account name.')
param accountName string

@description('App Service managed identity object ID.')
param applicationPrincipalId string

@description('Optional developer object ID for local Azure CLI access.')
param developerPrincipalId string = ''

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' existing = {
  name: accountName
}

var dataContributorRoleId = '${account.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'

resource applicationRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: account
  name: guid(account.id, applicationPrincipalId, dataContributorRoleId)
  properties: {
    principalId: applicationPrincipalId
    roleDefinitionId: dataContributorRoleId
    scope: account.id
  }
}

resource developerRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = if (!empty(developerPrincipalId)) {
  parent: account
  name: guid(account.id, developerPrincipalId, dataContributorRoleId)
  properties: {
    principalId: developerPrincipalId
    roleDefinitionId: dataContributorRoleId
    scope: account.id
  }
}
