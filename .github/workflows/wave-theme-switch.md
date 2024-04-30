# Wave Application Theme Change Test Plan

This test plan is designed to verify that the "Theme" setting within the "Client Settings" of the Wave application can be successfully changed to "Dark." The test will involve locating the "Theme" dropdown menu, clicking on it to expand the options, and then clicking on the "Dark" option. The test will be considered successful if the "Theme" setting reflects the "Dark" option after the actions are taken.

## Step 1: Locate and Click on the "Theme" Dropdown Menu

First, we need to find the "Theme" text on the screen and click on it to expand the dropdown menu.

```yml
commands:
  - command: click-text
    text: Theme
    comment: "Locate the 'Theme' dropdown menu on the screen."
  - command: wait
    timeout: 1
    comment: "Wait for a brief moment to ensure the dropdown menu is ready for interaction."
```

## Step 2: Take a Screenshot to Verify the Dropdown is Expanded

Take a screenshot to ensure that the "Theme" dropdown menu is expanded and ready for the next click action.

```yml
queries:
  - query: view
    comment: "Take a screenshot to verify that the 'Theme' dropdown menu is expanded."
```

## Step 3: Locate and Click on the "Dark" Option

After confirming the dropdown is expanded, find the "Dark" text and click on it to change the theme.

```yml
commands:
  - command: click-text
    text: Dark
    comment: "Locate the 'Dark' option within the expanded 'Theme' dropdown menu."
  - command: wait
    timeout: 1
    comment: "Wait for a brief moment to ensure the 'Dark' option is ready for interaction."
```

## Step 4: Final Screenshot to Confirm the Theme Change

Finally, take a screenshot to confirm that the "Theme" setting has been changed to "Dark."

```yml
queries:
  - query: view
    comment: "Take a screenshot to confirm that the 'Theme' setting shows 'Dark' as the selected option."
```

This plan outlines the steps to be taken to rerun the test in the future, ensuring that the "Theme" setting can be changed to "Dark" within the Wave application's "Client Settings." Each step is critical to the success of the test and should be executed in the order provided.