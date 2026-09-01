"""Compatibility with OwlSpotLight's embedding helper; cancellation kills the worker."""
def raise_if_cancelled():
    pass

def start(*args, **kwargs):
    pass

def update(*args, **kwargs):
    pass

def finish(*args, **kwargs):
    pass
