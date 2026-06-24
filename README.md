# LLMHub

Monorepo for the CAII LLM serving projects.

## Layout

- `backend/` - imported from `github.com/center-for-ai-innovation/llm-serving-backend`
- `frontend/` - imported from `github.com/Center-for-AI-Innovation/llm-serving-frontend`

Both projects were imported as unsquashed subtree-style merges so their original commit
histories are preserved in this repository.

## Updating Subtrees

The local remotes are:

```sh
git remote add backend https://github.com/center-for-ai-innovation/llm-serving-backend.git
git remote add frontend https://github.com/Center-for-AI-Innovation/llm-serving-frontend.git
```

To pull future upstream changes with `git subtree`:

```sh
git fetch backend main
git subtree pull --prefix=backend backend main

git fetch frontend main
git subtree pull --prefix=frontend frontend main
```

If `git subtree` is unavailable, install the Git subtree helper package for your
platform before running those commands.
