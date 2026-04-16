---
"@checkstack/auth-ldap-backend": patch
"@checkstack/ui": patch
---

Fix LDAP group-to-role mapping not assigning roles on login. The LDAP search now explicitly requests the `memberOf` operational attribute, which is not returned by default. Also fixes array flattening that discarded multi-valued group memberships, and adds case-insensitive DN comparison for group matching. The test LDAP environment now uses `groupOfUniqueNames` to enable the memberOf overlay. Additionally, the DynamicForm validation no longer blocks saving when optional array fields (like group mappings) are empty.
