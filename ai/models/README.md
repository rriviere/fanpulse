# Foundry model profiles

Files in `deployments/` explicitly describe the logical model profiles used by
FanPulse: deployed name, underlying model and pinned version, SKU, capacity,
region, capabilities, authentication, environment override, and runtime
defaults. Application code resolves these profiles rather than embedding model
settings.

Azure model resources remain provisioned by the repository's Bicep modules so
capacity, SKU, region, and role assignments stay in infrastructure as code. The
profile connects that provisioned deployment to agents and inference code.
