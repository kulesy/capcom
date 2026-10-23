# Attachments

How to attach images and files to a message, how each reaches Claude, and how the image viewer works.

## Images

Paste a screenshot anywhere on the page, drop image files onto it, or pick them with the +. Each attaches as a thumbnail above the text, with a cross to take it off again and a click to look at it in the [viewer](#the-image-viewer). A message takes up to 10 images in PNG, JPEG, GIF or WebP, and may be images alone.

### Size limits

Before it sends, the page scales anything over 2000 pixels on its long edge down and keeps each image under 3.75 MB, so that even as base64 it is under the 5 MB the API takes. It keeps PNG and falls back to JPEG only when a PNG is too big. The CLI then re-encodes any image over about 0.5 MB itself, so a large screenshot reaches Claude re-encoded whatever the page sent.

### Other image types

The page redraws an image of a type the API does not take, such as a HEIC photo in Safari, and sends it as an image when the browser can read it. An SVG goes as a file.

### Pasting

A paste that also holds several lines of text, as a spreadsheet copy does, pastes the text instead, and so does one with any text into another field. An image pasted alone into a field, such as a question's answer box, attaches to the prompt box, because the field would drop it.

### While Claude works

A message sent while Claude works can carry images too, and the CLI holds it until the running tool finishes, as it does a text message.

### In a transcript

Every message in a transcript that carries images shows them as thumbnails that open in the viewer on click, including messages sent from Desktop or a terminal. The pictures Claude gets back from its tools, such as a browser screenshot or an image file it reads, show the same way under the call that returned them (see [tool calls](chat.md#pictures-from-tools)).

## Files

The + also takes any other file, and so do a paste and a drop. Each shows as a card above the text with its name, kind and size, and a cross to take it off. A card says "Uploading..." while the file goes up, and Send waits for it. A message takes up to 10 files, each up to 30 MB, and may be files alone.

### How a file reaches Claude

GhostShell saves each file in the `uploads` folder of its state folder (the folder and its files are readable by the owner only) and starts the message with `@"/path/to/file"` for each one, as Desktop does, so the CLI reads the file itself. [The decision record](adr/20261023-attach-files-by-path.md) says why a file goes by path.

Claude sees a file by the name GhostShell saved it under, a UUID and the extension. GhostShell does not pass on the name the file had on your machine.

The CLI puts a text file or a CSV into the message. When tested, it asked no permission for it in any permission mode.

### PDFs

On CLI 2.1.309 a PDF mention gives Claude only a path and a size, so GhostShell reads each PDF with macOS's PDFKit when it arrives, for the page count and the text.

A PDF of 1 to 20 pages and at most 3 MB goes in the message as a document block, so Claude reads it with no tool call, and its text copy is not mentioned.

The PDFs in one message share those limits in the order attached, so together they come to at most 20 pages and 3 MB. The PDFs sent as documents in one chat share 40 pages and 10 MB, and GhostShell keeps the running total in `documents.json` in its state folder. The limits are low because the CLI sends every earlier block again on each turn, and a PDF the API refuses would fail every later turn of that chat.

Any other PDF is mentioned by path with its text copy, which the CLI puts in the message. A PDF that needs a password, or has no text such as a scan, has no text copy, so one of those that does not go as a document reaches Claude as a path only.

The CLI puts nothing of any file into a message sent while Claude works. There a PDF goes by path with its text copy, and Claude reads what it needs with the Read tool, which asked no permission in any mode when tested.

### Word documents

For Word documents (`.doc`, `.docx`, `.odt` and `.rtf`) the CLI reads nothing, so GhostShell converts the file to text with macOS's `textutil` when it arrives and mentions that copy as well.

### Other files

A spreadsheet, a slide deck or any other binary file reaches Claude as a path only, and Claude has to open it with a command, which asks in the modes that ask.

### In a transcript

A transcript shows each file as a card beside the images, with the path as its tooltip, for messages from Desktop too. A file GhostShell did not save shows with its name and no size.

### Limits and edge cases

- A slash command such as `/compact` cannot go with files, so GhostShell refuses that and puts the message back in the box.
- An upload that stops arriving for 60 seconds is dropped.
- The page asks the server once what it takes, so a new page served by a server that has not been restarted since the update stays on images only, and a pasted file that is not an image is left to the browser as before.
- Uploads stay on disk after sending, and so does a file that was attached and never sent.

## The image viewer

The viewer opens when you click or tap a thumbnail in a transcript (one still being sent included), a picture a tool returned to Claude, or a picture attached to the message you are writing. It shows the picture scaled to fit the screen. Esc, the cross at the top right or a click outside the picture closes it, and Esc does not stop a running chat. The link at the top opens the picture on its own in a new tab.

### Stepping through pictures

The left and right arrow keys, the arrows under the picture or a swipe step through the other pictures in that chat in the order the thread shows them, those you sent and those Claude's tools returned together, with a count such as "2 of 5" between the arrows. Pictures attached to the box you are writing step among themselves only.

The count and the arrows take in every picture in the chat, those in history the page has not loaded included, and an earlier picture shows without you scrolling up or pressing Load earlier. The page asks the server for that list (see [pictures before the loaded part](how-it-works.md#pictures-before-the-loaded-part)).

### Zoom

Pinch with two fingers on a phone or a trackpad to zoom in on the spot between them, or hold Ctrl and turn the scroll wheel. Double tap the picture to zoom in where you tapped, and double tap again to go back.

Actual size shows the middle of the picture at its own pixel size, and Fit to screen goes back. The button is greyed out until the picture has loaded, and when it already fits at its own size.

While the picture is zoomed, you move around it with a drag, a swipe, the scroll wheel or the arrow keys, so only the arrows under the picture step. Page Up and Page Down move it a screen at a time, and Home and End go to its top and bottom. The next picture opens at fit. A pinch does not step or zoom the page behind.

### Focus

While the viewer is open, Tab stays among its controls, and the page behind does not scroll or take keys. Closing the viewer puts focus back on the thumbnail you clicked, however far you stepped, so you stay where you were reading. If that thumbnail has gone, as when a message still being sent has arrived, focus goes to the same picture's new thumbnail, or else to the nearest thumbnail you can see.
