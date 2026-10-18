class FoundryRateLimitError(RuntimeError):
    """The current analysis window was rejected by a Foundry rate limit."""

    def __init__(self, stage: str):
        self.stage = stage
        super().__init__(f"Foundry rate limit reached during {stage}")
