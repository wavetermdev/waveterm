// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Markdown } from "@/app/element/markdown";

import "./helpview.less";

const helpText = `
## Blocks
Every individual Component is contained in its own block. These can be added, removed, moved and resized. Each block has its own header which can be right clicked to reveal more operations you can do with that block.

### How to Add a Block
Adding a block can be done using the widget bar on the right hand side of the window. This will add a block of the selected type to the current tab.

### How to Close a Block
Blocks can be closed by clicking the &#x2715; button on the right side of the header. Alternatively, the currently focused block can be closed by pressing \`Cmd + w\`.

### How to Navigate Blocks
At most, it is possible to have one block be focused. Depending on the type of block, this allows you to directly interact with the content in that block. A focused block is always outlined with a distinct border. A block may be focused by clicking on it. Alternatively, you can change the focused block by pressing <code>Cmd + &uarr;</code>, <code>Cmd + &darr;</code>, <code>Cmd + &larr;</code>, or <code>Cmd + &rarr;</code>to navigate relative to the currently selected block.
1
### How to Magnify Blocks
Magnifying a block will pop the block out in front of everything else. To magnify a block, simply double click the header. To un-magnify the block, double click the header again. Alternatively, you can magnify and un-magnify with \`Cmd + m\`.

### How to Reorganize Blocks
By dragging and dropping their headers, blocks can be moved to different locations in the layout. This effectively allows you to reorganize your screen however you see fit. When dragging, you will see a preview of the block that is being dragged. When the block is over a valid drop point, the area where it would be moved to will turn green. Releasing the click will place the block there and reflow the other blocks around it. If you see a green box cover half of two different blocks, the drop will place the block between the two. If you see the green box cover half of one block at the edge of the screen, the block will be placed between that block and the edge of the screen. If you see the green box cover one block entirely, the two blocks will swap locations.

### How to Resize Blocks
Hovering the mouse between two blocks changes your cursor to &harr; and reveals a green line dividing the blocks. By dragging and dropping this green line, you are able to resize the blocks adjacent to it.

## Types of Blocks

### Term
The usual terminal you know and love. We add a few plugins via the \`wsh\` command that you can read more about further below.

### Preview
Preview is the generic type of block used for viewing files. This can take many different forms based on the type of file being viewed.
You can use \`wsh view [path]\` from any Wave terminal window to open a preview block with the contents of the specified path (e.g. \`wsh view .\` or \`wsh view ~/myimage.jpg\`).

#### Directory
When looking at a directory, preview will show a file viewer much like MacOS' *Finder* application or Windows' *File Explorer* application. This variant is slightly more geared toward software development with the focus on seeing what is shown by the \`ls -alh\` command.

##### View a New File
The simplest way to view a new file is to double click its row in the file viewer. Alternatively, while the block is focused, you can use the &uarr; and &darr; arrow keys to select a row and press enter to preview the associated file.

##### View the Parent Directory
In the directory view, this is as simple as opening the \`..\` file as if it were a regular file. This can be done with the method above.

##### Filter the List of Files
While the block is focused, you can filter by filename by typing a substring of the filename you're working for. To clear the filter, you can click the &#x2715; on the filter dropdown or press esc.

##### Sort by a File Column
To sort a file by a specific column, click on the header for that column. If you click the header again, it will reverse the sort order.

##### Hide and Show Hidden Files
At the right of the block header, there is an &#128065;&#65039; button. Clicking this button hides and shows hidden files.

##### Refresh the Directory
At the right of the block header, there is a refresh button. Clicking this button refreshes the directory contents.

##### Navigate to Common Directories
At the left of the block header, there is a file icon. Clicking and holding on this icon opens a menu where you can select a common folder to navigate to. The available options are *Home*, *Desktop*, *Downloads*, and *Root*.

##### Open a New Terminal in the Current Directory
If you right click the header of the block (alternatively, click the gear icon), one of the menu items listed is **Open Terminal in New Block**. This will create a new terminal block at your current directory.

##### Open a New Terminal in a Child Directory
If you want to open a terminal for a child directory instead, you can right click on that file's row to get the **Open Terminal in New Block** option. Clicking this will open a terminal at that directory. Note that this option is only available for children that are directories.

##### Open a New Preview for a Child
To open a new Preview Block for a Child, you can right click on that file's row and select the **Open Preview in New Block** option.

#### Markdown
Opening a markdown file will bring up a view of the rendered markdown. These files cannot be edited in the preview at this time.

#### Images/Media
Opening a picture will bring up the image of that picture. Opening a video will bring up a player that lets you watch the video.

### Codeedit
Opening most text files will open Codeedit to either view or edit the file. It is technically part of the Preview block, but it is important enough to be singled out.
After opening a codeedit block, it is often useful to magnify it (\`Cmd + m\`) to get a larger view.  You can then
use the hotkeys below to switch to edit mode, make your edits, save, and then use \`Cmd + w\` to close the block (all without using the mouse!).

#### Switch to Edit Mode
To switch to edit mode, click the edit button to the right of the header. This lets you edit the file contents with a regular monaco editor.
You can also switch to edit mode by pressing \`Cmd + e\`.

#### Save an Edit
Once an edit has been made in **edit mode**, click the save button to the right of the header to save the contents.
You can also save by pressing \`Cmd + s\`.

#### Exit Edit Mode Without Saving
To exit **edit mode** without saving, click the cancel button to the right of the header.
You can also exit without saving by pressing \`Cmd + r\`.

### AI

#### How to Ask an LLM a Question
Asking a question is as simple as typing a message in the prompt and pressing enter. By default, we forward messages to the *gpt-3.5-turbo* model through our server.

#### How To Change The Model
See *settings help* for more info on how to configure your model.

### Web
The Web block is basically a simple web browser. The forward and backwards navigation have been added to the header.
You can use \`wsh\` to interact with the web block's URL (see the wsh section below).

### Cpu %
A small plot displaying the % of CPU in use over time. This is an example of a block that is capable of plotting streamed data. We plan to make this more generic in the future.

## Tabs
Tabs are ways to organize your blocks into separate screens. They mostly work the way you're used to in other apps.

### Create a New Tab
A tab can be created by clicking the plus button to the right of your currently existing tabs

### Delete a Tab
Hovering a tab reveals an &#x2715; button to the right side of it. Clicking it removes the tab. Note that this will also remove the instances of the blocks it contains.

### Change a Tab Name
Double clicking the current tab name makes it possible to change the name of your tab. You are limited to 10 glyphs in your tab name. Note that we say glyphs because it is possible to use multiple-character glyphs including emojis in your tab name.

### Reorganize Tabs
Tabs can be reorganized by dragging and dropping them to the left and right of other tabs.

## Theming
It is possible to style each tab individually. This is most-easily done by right clicking on your tab and going to the background menu. From there, you can select from five different pre-made styles.

It is possible to get more fine-grained control of the styles as well. See *settings help* for more info.

## wsh command

The wsh command is always available from wave terminal windows.  It is a powerful tool for interacting with Wave blocks and can bridge data between your CLI and the widget GUIs.

### view
You can open a preview block with the contents of any file or directory by running:

\`\`\`
wsh view [path]
\`\`\`

You can use this command to easily preview images, markdown files, and directories.  For code/text files this will open
a codeedit block which you can use to quickly edit the file using Wave's embedded graphical editor.

### getmeta

You can view the metadata of any block by running:

\`\`\`
wsh getmeta [blockid]
\`\`\`

This is especially useful for preview and web blocks as you can see the file or url that they are pointing to and use that in your CLI scripts.

### setmeta

You can update any metadata key value pair for blocks (and tabs) by using the setmeta command:

\`\`\`
wsh setmeta [blockid] [key]=[value]
wsh setmeta [blockid] file=~/myfile.txt
wsh setmeta [blockid] url=https://waveterm.dev/
\`\`\`

You can get block and tab ids by right clicking on the appropriate block and selecting "Copy BlockId".  When you
update the metadata for a preview or web block you'll see the changes reflected instantly in the block.

Other useful metadata values to override block titles, icons, colors, themes, etc. can be found in the documentation.

`;

function HelpView() {
    return <Markdown text={helpText} className="help-view" />;
}

export { HelpView };
