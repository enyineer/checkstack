---
"@checkstack/ui": minor
---

Enhanced DateTimePicker with calendar popup and independent field editing

- Added calendar popup using `react-day-picker` and Radix Popover for date selection
- Implemented independent input fields for day, month, year, hour, and minute
- Added input validation with proper clamping on blur (respects leap years)
- Updated `onChange` signature to `Date | undefined` to handle invalid states
- Fixed Dialog focus ring clipping by adding wrapper with negative margin/padding
