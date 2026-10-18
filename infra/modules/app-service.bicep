@description('Azure region for the App Service plan and web app.')
param location string

@description('Name of the Linux App Service plan.')
param appServicePlanName string

@description('Globally unique name of the FanPulse web app.')
param webAppName string

@description('App Service SKU. B1 is the default tier for reliable hackathon demonstrations.')
param appServiceSkuName string = 'B1'

@description('Foundry account name used for managed-identity role assignment.')
param foundryAccountName string

@description('Foundry project name used for managed-identity role assignment.')
param foundryProjectName string

@description('Foundry project endpoint used by the backend.')
param foundryProjectEndpoint string

@description('Existing multimodal model deployment name.')
param visionModelDeploymentName string

@description('Existing persisted Match Analyst agent name, provisioned from ai/agents.')
param matchAnalystAgentName string

@description('Existing persisted Fan Engagement agent name, provisioned from ai/agents.')
param fanEngagementAgentName string

@description('Azure Cosmos DB for NoSQL endpoint.')
param cosmosEndpoint string

@description('Cosmos DB database name.')
param cosmosDatabaseName string

@description('Cosmos DB container name.')
param cosmosContainerName string

@description('Resource tags.')
param tags object

var skuTier = appServiceSkuName == 'F1' ? 'Free' : 'Basic'

resource appServicePlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  tags: tags
  sku: {
    name: appServiceSkuName
    tier: skuTier
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource webApp 'Microsoft.Web/sites@2024-04-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
  tags: union(tags, {
    'azd-service-name': 'web'
  })
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'PYTHON|3.12'
      appCommandLine: 'PYTHONPATH=/home/site/wwwroot/.python_packages/lib/site-packages python -m uvicorn apps.api.app.main:app --host 0.0.0.0 --port 8000 --workers 1 --access-log'
      alwaysOn: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      webSocketsEnabled: true
      http20Enabled: true
      appSettings: [
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        {
          name: 'ENABLE_ORYX_BUILD'
          value: 'false'
        }
        {
          name: 'PYTHONPYCACHEPREFIX'
          value: '/tmp/fanpulse-python-cache'
        }
        {
          name: 'FOUNDRY_PROJECT_ENDPOINT'
          value: foundryProjectEndpoint
        }
        {
          name: 'FOUNDRY_VISION_MODEL_DEPLOYMENT'
          value: visionModelDeploymentName
        }
        {
          name: 'FOUNDRY_MATCH_ANALYST_AGENT'
          value: matchAnalystAgentName
        }
        {
          name: 'FOUNDRY_FAN_ENGAGEMENT_AGENT'
          value: fanEngagementAgentName
        }
        {
          name: 'COSMOS_ENDPOINT'
          value: cosmosEndpoint
        }
        {
          name: 'COSMOS_DATABASE_NAME'
          value: cosmosDatabaseName
        }
        {
          name: 'COSMOS_CONTAINER_NAME'
          value: cosmosContainerName
        }
      ]
    }
  }
}

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: foundryAccountName
}

resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' existing = {
  parent: foundryAccount
  name: foundryProjectName
}

resource webAppOpenAIUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, webApp.id, 'Cognitive Services OpenAI User')
  scope: foundryAccount
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  }
}

resource webAppFoundryUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryProject.id, webApp.id, 'Foundry User')
  scope: foundryProject
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '53ca6127-db72-4b80-b1b0-d745d6d5456d')
  }
}

output webAppName string = webApp.name
output webAppPrincipalId string = webApp.identity.principalId
output webAppUri string = 'https://${webApp.properties.defaultHostName}'
output appServicePlanName string = appServicePlan.name
output appServiceSkuName string = appServiceSkuName
