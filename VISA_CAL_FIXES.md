# Visa Cal Scraper Fixes

## Summary
This PR fixes three critical issues with the Visa Cal scraper that were preventing successful login and transaction retrieval.

## Issues Fixed

### 1. Login Button Not Responding to Programmatic Clicks
**Problem**: The Angular Material login button doesn't respond to programmatic `.click()` calls.

**Root Cause**: Angular Material components use complex event handling that doesn't trigger on programmatic clicks.

**Solution**: Instead of clicking the button, press Enter on the password field, which properly triggers Angular's form submission handlers.

**Changes**:
- Modified `submitButtonSelector` from a simple selector string to an async function
- The function focuses on the password field and presses Enter
- Added appropriate delays for form processing

### 2. WhatsApp Notification Popup Blocking Navigation
**Problem**: After successful login, a WhatsApp notification popup appears and blocks navigation to the dashboard.

**Solution**: Automatically detect and close the popup in the `postAction` handler.

**Changes**:
- Added popup detection logic with multiple selector attempts
- Closes the popup if found before proceeding with navigation

### 3. API Structure Change - bankIssuedCards → calIssuedCards
**Problem**: The Visa Cal API changed the response structure from `frames.result.bankIssuedCards.cardLevelFrames` to `frames.result.calIssuedCards.accountLevelFrames`.

**Solution**: Support both old and new API structures for backward compatibility.

**Changes**:
- Updated `FramesResponse` interface to include both structures
- Modified frame lookup logic to try new structure first, fall back to old structure
- Maintains backward compatibility with older API versions

## Technical Details

### Change 1: Submit Button Selector
**Before**:
```typescript
submitButtonSelector: 'button[type="submit"]',
```

**After**:
```typescript
submitButtonSelector: async () => {
  const frame = await getLoginFrame(this.page);
  await new Promise(resolve => setTimeout(resolve, 2000));
  const passwordField = await frame.$('[formcontrolname="password"]');
  if (passwordField) {
    await passwordField.focus();
    await passwordField.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
},
```

### Change 2: WhatsApp Popup Closing
**Added to postAction** (after line 425):
```typescript
// Close WhatsApp popup if it appears
await new Promise(resolve => setTimeout(resolve, 3000));
const selectors = [
  'button.close[data-dismiss="modal"]',
  'button.close[title="סגירה"]',
  '.modal-header button.close'
];

for (const selector of selectors) {
  try {
    const closeButton = await this.page.$(selector);
    if (closeButton) {
      await closeButton.click();
      await new Promise(resolve => setTimeout(resolve, 1000));
      break;
    }
  } catch (e) {
    // Continue to next selector
  }
}
```

### Change 3: API Structure Support
**Before** (FramesResponse interface):
```typescript
interface FramesResponse {
  result?: {
    bankIssuedCards?: {
      cardLevelFrames?: CardLevelFrame[];
    };
  };
}
```

**After**:
```typescript
interface FramesResponse {
  result?: {
    bankIssuedCards?: {
      cardLevelFrames?: CardLevelFrame[];
    };
    calIssuedCards?: {
      accountLevelFrames?: CardLevelFrame[];
    };
  };
}
```

**Before** (frame lookup at line 477):
```typescript
const frame = _.find(frames.result?.bankIssuedCards?.cardLevelFrames, { cardUniqueId: card.cardUniqueId });
```

**After**:
```typescript
// Support both old and new API structures
let cardFrames;
if (frames.result?.calIssuedCards?.accountLevelFrames) {
  cardFrames = frames.result.calIssuedCards.accountLevelFrames;
} else if (frames.result?.bankIssuedCards?.cardLevelFrames) {
  cardFrames = frames.result.bankIssuedCards.cardLevelFrames;
}
const frame = _.find(cardFrames, { cardUniqueId: card.cardUniqueId });
```

## Testing
All fixes have been tested on both macOS (local development) and Raspberry Pi (production) environments and confirmed working.

## Backward Compatibility
The API structure change maintains full backward compatibility by checking for both old and new structures.
