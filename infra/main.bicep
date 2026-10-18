targetScope = 'resourceGroup'

@description('Azure region for the FanPulse Foundry account, project, model deployment, and storage account.')
param location string = 'australiaeast'

@description('azd environment name, used for tags and deterministic globally-unique resource names.')
param environmentName string = 'fanpulse-dev'

@description('Name of the Microsoft Foundry project. This is a child resource and can use the requested stable name.')
param foundryProjectName string = 'fanpulse-dev'

@description('Globally unique Microsoft Foundry account name. The default preserves the requested name and deployment will report if it is already taken.')
param foundryAccountName string = 'fanpulse-dev'

@description('Optional Microsoft Entra object ID to grant Storage Blob Data Contributor for development uploads. Leave empty until a developer identity is selected.')
param developerPrincipalId string = ''

@description('Optional Foundry Match Analyst runtime identity object ID for Entra-authenticated trace ingestion.')
param matchAnalystPrincipalId string = ''

@description('Optional Foundry Fan Engagement runtime identity object ID for Entra-authenticated trace ingestion.')
param fanEngagementPrincipalId string = ''

@description('Pay-as-you-go multimodal model deployment used by the Phase 2 vision proof of concept.')
param visionModelDeploymentName string = 'gpt-5-mini'

@description('Persisted Foundry Match Analyst agent used by the hosted backend.')
param matchAnalystAgentName string = 'fanpulse-match-analyst'

@description('Persisted Foundry Fan Engagement agent used by the hosted backend.')
param fanEngagementAgentName string = 'fanpulse-fan-engagement'

@description('App Service SKU for the development deployment. B1 avoids the daily CPU quota imposed by F1.')
@allowed([
  'F1'
  'B1'
])
param appServiceSkuName string = 'B1'

var nameSuffix = uniqueString(subscription().id, resourceGroup().id, environmentName)
var storageAccountName = 'fanpulse${take(nameSuffix, 18)}'
var logAnalyticsWorkspaceName = 'log-${environmentName}'
var applicationInsightsName = 'appi-${environmentName}'
var appServicePlanName = 'plan-${environmentName}'
var webAppName = 'app-${environmentName}-${take(nameSuffix, 8)}'
var cosmosAccountName = 'cosmos-${environmentName}-${take(nameSuffix, 8)}'
var tags = {
  application: 'fanpulse'
  environment: environmentName
  managedBy: 'azd'
  purpose: 'football-video-analysis'
}

module storage './modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    storageAccountName: storageAccountName
    tags: tags
    developerPrincipalId: developerPrincipalId
  }
}

module foundry './modules/foundry.bicep' = {
  name: 'foundry'
  params: {
    location: location
    accountName: foundryAccountName
    projectName: foundryProjectName
    storageAccountId: storage.outputs.id
    storageAccountName: storage.outputs.name
    developerPrincipalId: developerPrincipalId
    tags: tags
  }
}

module visionModel './modules/model-deployment.bicep' = {
  name: 'vision-model'
  params: {
    accountName: foundry.outputs.accountName
    deploymentName: visionModelDeploymentName
    modelName: 'gpt-5-mini'
    modelVersion: '2025-08-07'
    skuName: 'GlobalStandard'
    capacity: 10
  }
}

module observability './modules/observability.bicep' = {
  name: 'observability'
  params: {
    location: location
    workspaceName: logAnalyticsWorkspaceName
    applicationInsightsName: applicationInsightsName
    tags: tags
  }
}

module cosmos './modules/cosmos.bicep' = {
  name: 'cosmos'
  params: {
    location: location
    accountName: cosmosAccountName
    tags: tags
  }
}

module foundryObservabilityConnection './modules/foundry-observability-connection.bicep' = {
  name: 'foundry-observability-connection'
  params: {
    accountName: foundry.outputs.accountName
    projectName: foundry.outputs.projectName
    applicationInsightsId: observability.outputs.applicationInsightsId
    applicationInsightsName: observability.outputs.applicationInsightsName
    projectPrincipalId: foundry.outputs.projectPrincipalId
    agentPrincipalId: matchAnalystPrincipalId
    fanEngagementPrincipalId: fanEngagementPrincipalId
    developerPrincipalId: developerPrincipalId
    location: location
  }
}

module appService './modules/app-service.bicep' = {
  name: 'app-service'
  params: {
    location: location
    appServicePlanName: appServicePlanName
    webAppName: webAppName
    appServiceSkuName: appServiceSkuName
    foundryAccountName: foundry.outputs.accountName
    foundryProjectName: foundry.outputs.projectName
    foundryProjectEndpoint: foundry.outputs.projectEndpoint
    visionModelDeploymentName: visionModel.outputs.deploymentName
    matchAnalystAgentName: matchAnalystAgentName
    fanEngagementAgentName: fanEngagementAgentName
    cosmosEndpoint: cosmos.outputs.endpoint
    cosmosDatabaseName: cosmos.outputs.databaseName
    cosmosContainerName: cosmos.outputs.containerName
    tags: tags
  }
}

module cosmosRoleAssignments './modules/cosmos-role-assignments.bicep' = {
  name: 'cosmos-role-assignments'
  params: {
    accountName: cosmos.outputs.accountName
    applicationPrincipalId: appService.outputs.webAppPrincipalId
    developerPrincipalId: developerPrincipalId
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = resourceGroup().name
output FOUNDRY_ACCOUNT_NAME string = foundry.outputs.accountName
output FOUNDRY_PROJECT_NAME string = foundry.outputs.projectName
output FOUNDRY_ENDPOINT string = foundry.outputs.endpoint
output FOUNDRY_PROJECT_ENDPOINT string = foundry.outputs.projectEndpoint
output FOUNDRY_PROJECT_RESOURCE_ID string = foundry.outputs.projectResourceId
output FOUNDRY_VISION_MODEL_DEPLOYMENT string = visionModel.outputs.deploymentName
output FOUNDRY_APP_INSIGHTS_CONNECTION string = foundryObservabilityConnection.outputs.connectionName
output APPLICATION_INSIGHTS_NAME string = observability.outputs.applicationInsightsName
output APPLICATION_INSIGHTS_RESOURCE_ID string = observability.outputs.applicationInsightsId
output LOG_ANALYTICS_WORKSPACE_NAME string = observability.outputs.logAnalyticsWorkspaceName
output LOG_ANALYTICS_WORKSPACE_RESOURCE_ID string = observability.outputs.logAnalyticsWorkspaceId
output STORAGE_ACCOUNT_NAME string = storage.outputs.name
output STORAGE_ACCOUNT_RESOURCE_ID string = storage.outputs.id
output FOOTBALL_VIDEOS_CONTAINER string = storage.outputs.containerName
output COSMOS_ACCOUNT_NAME string = cosmos.outputs.accountName
output COSMOS_ENDPOINT string = cosmos.outputs.endpoint
output COSMOS_DATABASE_NAME string = cosmos.outputs.databaseName
output COSMOS_CONTAINER_NAME string = cosmos.outputs.containerName
output APP_SERVICE_PLAN_NAME string = appService.outputs.appServicePlanName
output APP_SERVICE_SKU string = appService.outputs.appServiceSkuName
output WEB_APP_PRINCIPAL_ID string = appService.outputs.webAppPrincipalId
output FOUNDRY_FAN_ENGAGEMENT_AGENT string = fanEngagementAgentName
output SERVICE_WEB_NAME string = appService.outputs.webAppName
output SERVICE_WEB_URI string = appService.outputs.webAppUri
