# Individual Contributor License Agreement (CLA)

Thank you for your interest in contributing to Checkmate ("We" or "Us").

This Contributor License Agreement ("Agreement") creates a legal record of the terms under which you contribute code, documentation, or other material ("Contribution") to the project.

By contributing, you agree to the following terms:

**1. Definitions**
"You" means the individual who submits a Contribution. This usually means the Copyright holder.

**2. Grant of Copyright License**
You hereby grant to Us and the maintainers of this project a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute Your Contribution and such derivative works.

*Note: This grants us the right to include your code in our project and license it to users under our standard license (Elastic License 2.0) or a commercial license.*

**3. Grant of Patent License**
You hereby grant to Us a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by You that are necessarily infringed by Your Contribution.

**4. You Represent That You Are legally Entitled to Grant These Rights**
You represent that You are the sole owner of the Contribution or have the authority to make the Contribution under these terms.

**5. No Other Rights**
Apart from the licenses granted above, You retain all ownership rights, title, and interest in and to Your Contribution.

**6. "As Is"**
You provide Your Contribution on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE.

---

## Creating a Changeset

When contributing code changes to Checkmate, you'll need to create a **changeset** to document your changes. Changesets help us manage versioning and generate changelogs automatically.

### When to Create a Changeset

Create a changeset when your PR includes:
- ✅ Bug fixes
- ✅ New features
- ✅ Breaking changes
- ✅ Performance improvements
- ✅ API changes

You typically **don't need** a changeset for:
- ❌ Documentation-only changes
- ❌ Test-only changes
- ❌ CI/build configuration changes

### How to Create a Changeset

1. Make your code changes
2. Run the changeset command:
   ```bash
   bun changeset
   ```
3. Select which packages changed
4. Choose the version bump type (patch/minor/major)
5. Write a clear summary of your changes
6. Commit the generated changeset file along with your code

### Example

```bash
$ bun changeset
🦋  Which packages would you like to include?
◉ @checkmate-monitor/auth-backend

🦋  Which packages should have a patch bump?
◉ @checkmate-monitor/auth-backend

🦋  Please enter a summary for this change:
Fixed session timeout handling in authentication middleware
```

This will create a new file in `.changeset/` that you should commit with your changes.

### Changeset Bot

When you create a pull request, the Changeset Bot will automatically comment to let you know if a changeset is needed. If you forgot to add one, the bot provides a helpful link to create it.

For more detailed information, see our [Changesets documentation](docs/changesets.md).