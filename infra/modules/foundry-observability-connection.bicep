@description('Existing Microsoft Foundry account name.')
param accountName string

@description('Existing Microsoft Foundry project name.')
param projectName string

@description('Application Insights resource ID to connect for Foundry traces.')
param applicationInsightsId string

@description('Application Insights resource name, used for RBAC scope.')
param applicationInsightsName string

@description('Project managed identity object ID used for Entra-authenticated trace ingestion.')
param projectPrincipalId string

@description('Optional Foundry agent runtime identity object ID used for Entra-authenticated trace ingestion.')
param agentPrincipalId string = ''

@description('Optional Fan Engagement agent runtime identity object ID used for Entra-authenticated trace ingestion.')
param fanEngagementPrincipalId string = ''

@description('Optional developer Microsoft Entra object ID allowed to read traces.')
param developerPrincipalId string = ''

@description('Azure region recorded in connection metadata.')
param location string

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: accountName
}

resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' existing = {
  parent: foundryAccount
  name: projectName
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: applicationInsightsName
}

resource appInsightsConnection 'Microsoft.CognitiveServices/accounts/projects/connections@2026-03-01' = {
  parent: foundryProject
  name: 'fanpulse-appinsights'
  // ProjectManagedIdentity is supported by the service and required by the
  // Foundry trace-ingestion guidance, but is missing from this Bicep API's
  // generated authType union as of October 2026.
  properties: any({
    category: 'AppInsights'
    target: applicationInsightsId
    authType: 'ProjectManagedIdentity'
    useWorkspaceManagedIdentity: true
    isSharedToAll: false
    metadata: {
      ApiType: 'Azure'
      ResourceId: applicationInsightsId
      // Required by the Foundry AppInsights connection contract even for
      // project-managed-identity auth. App Insights local auth is disabled.
      ApplicationInsightsConnectionString: applicationInsights.properties.ConnectionString
      location: location
    }
  })
}

resource foundryTracePublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(applicationInsightsId, projectPrincipalId, 'Monitoring Metrics Publisher')
  scope: applicationInsights
  properties: {
    principalId: projectPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
  }
}

resource agentTracePublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(agentPrincipalId)) {
  name: guid(applicationInsightsId, agentPrincipalId, 'Monitoring Metrics Publisher')
  scope: applicationInsights
  properties: {
    principalId: agentPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
  }
}

resource fanEngagementTracePublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(fanEngagementPrincipalId)) {
  name: guid(applicationInsightsId, fanEngagementPrincipalId, 'Monitoring Metrics Publisher')
  scope: applicationInsights
  properties: {
    principalId: fanEngagementPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
  }
}

resource developerTraceReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(developerPrincipalId)) {
  name: guid(applicationInsightsId, developerPrincipalId, 'Log Analytics Reader')
  scope: applicationInsights
  properties: {
    principalId: developerPrincipalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '73c42c96-874c-492b-b04d-ab87d138a893')
  }
}

output connectionName string = appInsightsConnection.name
