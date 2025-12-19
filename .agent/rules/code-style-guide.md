---
trigger: always_on
---

# Linting

Always run "bun run lint ." in the project root after you've made changes to make sure that you're not breaking any linter rules. If there are linter errors, fix them before considering your changes done.

# Validation

When type-checking or validation of a type is necessary, ALWAYS use the library "zod" and write zod-schemas.

# Code structure

ALWAYS keep the code well structured and modular.

ALWAYS use typed objects for function arguments, try to avoid positional arguments. ALWAYS use object destructuring in functions to destructure the "props" given to the function.