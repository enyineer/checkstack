---
"@checkstack/backend-api": minor
"@checkstack/healthcheck-frontend": minor
---

Add array assertion operators for string array fields

New operators for asserting on array fields (e.g., playerNames in RCON collectors):

- **includes** - Check if array contains a specific value
- **notIncludes** - Check if array does NOT contain a specific value
- **lengthEquals** - Check if array length equals a value
- **lengthGreaterThan** - Check if array length is greater than a value
- **lengthLessThan** - Check if array length is less than a value
- **isEmpty** - Check if array is empty
- **isNotEmpty** - Check if array has at least one element

Also exports a new `arrayField()` schema factory for creating array assertion schemas.
