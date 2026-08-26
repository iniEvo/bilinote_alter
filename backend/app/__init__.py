from fastapi import FastAPI

from .routers import artifacts, config, model, note, provider



def create_app(lifespan, include_chat: bool = True) -> FastAPI:
    app = FastAPI(title="BiliNote", lifespan=lifespan)
    app.include_router(note.router, prefix="/api")
    app.include_router(provider.router, prefix="/api")
    app.include_router(model.router, prefix="/api")
    app.include_router(config.router, prefix="/api")
    app.include_router(artifacts.router, prefix="/api")
    if include_chat:
        from .routers import chat
        app.include_router(chat.router, prefix="/api")

    return app
