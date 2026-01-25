# Spec 006: Search and Filter System

## Objective
Implement comprehensive search and filtering for settings, similar to VS Code's settings search.

## Context
VS Code allows searching settings by name, description, tags, and even setting keys. Users can also filter to show only modified settings or settings in a specific category.

## Implementation Steps

### Step 1: Create Search Index
Create `frontend/app/view/waveconfig/settings-search.ts`:
- Build searchable index from settings registry
- Index: key, label, description, tags, category
- Normalize text (lowercase, remove special chars)
- Support prefix matching and fuzzy matching

### Step 2: Implement Search Algorithm
Create efficient search:
```typescript
interface SearchResult {
  setting: SettingMetadata;
  score: number;
  matches: {
    field: 'label' | 'description' | 'key' | 'tags';
    indices: [number, number][]; // for highlighting
  }[];
}

function searchSettings(query: string, options?: SearchOptions): SearchResult[];
```

### Step 3: Add Search Highlighting
Highlight matched text in results:
- Bold or highlight the matched portions
- Show which field matched (label, description, key)
- Highlight in setting row component

### Step 4: Create Filter Options
Add filter toggles:
- "Modified" - show only settings that differ from default
- "Recently changed" - show settings modified in current session
- Category filter - show only settings in selected category
- Platform filter - show only settings for current platform

### Step 5: Create Search Input Component
Create `frontend/app/view/waveconfig/settings-search-input.tsx`:
- Text input with search icon
- Clear button (X)
- Filter dropdown/toggles
- Keyboard shortcut hint (Cmd/Ctrl+F)
- "X results found" indicator

### Step 6: Implement Search Results View
When searching:
- Hide category sidebar (or dim it)
- Show flat list of matching settings
- Sort by relevance score
- Group by category with collapsed headers
- Show match context (why it matched)

### Step 7: Add Keyboard Navigation
- Cmd/Ctrl+F focuses search input
- Escape clears search and returns to normal view
- Arrow keys navigate results
- Enter selects/focuses setting

### Step 8: Create useSettingsSearch Hook
```typescript
function useSettingsSearch(): {
  query: string;
  setQuery: (query: string) => void;
  results: SearchResult[];
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  isSearching: boolean;
  clearSearch: () => void;
}
```

### Step 9: Add Search History
Store recent searches:
- Show dropdown with recent searches
- Limit to last 10 searches
- Clear history option
- Store in localStorage

### Step 10: Implement "Find Setting by Key"
Support searching by exact key:
- Type `@key:term:fontsize` to jump to exact setting
- Useful for power users
- Link from documentation

## Files to Create/Modify
- **Create**: `frontend/app/view/waveconfig/settings-search.ts`
- **Create**: `frontend/app/view/waveconfig/settings-search-input.tsx`
- **Create**: `frontend/app/view/waveconfig/use-settings-search.ts`
- **Modify**: `frontend/app/view/waveconfig/settings-visual.tsx`
- **Modify**: `frontend/app/view/waveconfig/setting-row.tsx` (add highlighting)

## Acceptance Criteria
- [ ] Search finds settings by label, description, key, tags
- [ ] Search results are ranked by relevance
- [ ] Matched text is highlighted
- [ ] "Modified" filter works correctly
- [ ] Category filter works correctly
- [ ] Keyboard navigation works
- [ ] Search is performant (no lag)
- [ ] Search history is saved
- [ ] Clear search returns to normal view

## Security Considerations
- Sanitize search input before display
- Don't execute search input as code
- Limit search history stored

## Testing Requirements
- Test search algorithm accuracy
- Test relevance ranking
- Test filter combinations
- Test keyboard navigation
- Test performance with many settings
- Test edge cases (empty query, special chars)

## Dependencies
- Spec 001 (Settings Schema)
- Spec 003 (Settings View)
