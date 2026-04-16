# LDAP Auth Plugin for Checkstack

This plugin provides LDAP authentication support for the Checkstack platform.

## Local Test Environment

To test LDAP authentication locally, we provide a pre-configured OpenLDAP server with demo data.

### 1. Start the LDAP Server

```bash
cd docker
docker-compose up -d
```

This will start:
- **OpenLDAP**: Port `389`
- **phpLDAPadmin**: Port `8080` (Web UI)

### 2. Test Credentials

- **LDAP URL**: `ldap://localhost:389`
- **Bind DN**: `cn=admin,dc=example,dc=org`
- **Bind Password**: `adminpassword`
- **User Search Base**: `ou=People,dc=example,dc=org`
- **Group Search Base**: `ou=Groups,dc=example,dc=org`

#### Test User
- **Username**: `john`
- **Password**: `password`
- **Groups**: `admins`

### 3. Web UI

You can manage the LDAP server by visiting [http://localhost:8080](http://localhost:8080).

**Login Credentials for Web UI:**
- **Login DN**: `cn=admin,dc=example,dc=org`
- **Password**: `adminpassword`

> **Note**: If you get a "connection is unencrypted" warning, you can ignore it as this is a local development container.
