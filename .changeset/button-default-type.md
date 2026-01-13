---
"@checkstack/ui": minor
---

# Button component defaults to type="button"

The `Button` component now defaults to `type="button"` instead of the HTML default `type="submit"`. This prevents accidental form submissions when buttons are placed inside forms but aren't intended to submit.

## Changes

- Default `type` prop is now `"button"` instead of the HTML implicit `"submit"`
- Form submission buttons must now explicitly set `type="submit"`

## Migration

No migration needed if your submit buttons already have `type="submit"` explicitly set (recommended practice). If you have buttons that should submit forms but don't have an explicit type, add `type="submit"`:

```diff
- <Button onClick={handleSubmit}>Submit</Button>
+ <Button type="submit">Submit</Button>
```
