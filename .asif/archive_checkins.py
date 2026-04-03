#!/usr/bin/env python3
"""
Archive NEXUS check-ins 1–240 to NEXUS-checkins-archive-2026-Q1.md.
Keeps check-ins 241+ live in NEXUS.md.
"""

import re

NEXUS_PATH = '/home/axw/projects/voice-jib-jab/.asif/NEXUS.md'
ARCHIVE_PATH = '/home/axw/projects/voice-jib-jab/.asif/NEXUS-checkins-archive-2026-Q1.md'

with open(NEXUS_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')
n = len(lines)

# ---------------------------------------------------------------------------
# Step 1: Identify the line ranges of every "## Team Feedback" section.
#         A section runs from its header line up to (but not including) the
#         next "## " header (or end-of-file).
# ---------------------------------------------------------------------------

tf_sections = []   # list of (header_line_idx, last_line_idx_inclusive)
in_tf = False
tf_start = None

for i, line in enumerate(lines):
    if line.startswith('## Team Feedback'):
        if in_tf:
            tf_sections.append((tf_start, i - 1))
        in_tf = True
        tf_start = i
    elif line.startswith('## ') and in_tf:
        tf_sections.append((tf_start, i - 1))
        in_tf = False
        tf_start = None

if in_tf:
    tf_sections.append((tf_start, n - 1))

print(f"Found {len(tf_sections)} '## Team Feedback' section(s)")
for s, e in tf_sections:
    print(f"  Lines {s+1}–{e+1}: '{lines[s]}'")

# ---------------------------------------------------------------------------
# Step 2: Within each TF section, identify individual session blocks.
#         A block starts at a "> Session:" line and ends at the closing "---"
#         separator (inclusive).  The blank lines immediately before a
#         "> Session:" line are considered the inter-block gap (kept with the
#         *preceding* block or with the section header for the first block).
# ---------------------------------------------------------------------------

SESSION_RE = re.compile(r'^> Session:.*\(check-in (\d+)\)')

# We'll represent the content of a TF section as a list of "items":
#   {'type': 'header', 'lines': [...]}       — the "## Team Feedback\n\n" part
#   {'type': 'block',  'lines': [...], 'checkin': N}  — one session block
#   {'type': 'tail',   'lines': [...]}       — any trailing lines after last ---

def parse_tf_section(section_lines, section_start_lineno):
    """Returns list of items (dicts) describing the section."""
    items = []
    i = 0

    # The header is lines up to (but not including) the first "> Session:" line
    # (accounting for blank lines before it)
    header_end = 0
    for j, l in enumerate(section_lines):
        if SESSION_RE.match(l):
            header_end = j
            break
    else:
        # No session blocks in this section
        items.append({'type': 'header', 'lines': section_lines[:]})
        return items

    items.append({'type': 'header', 'lines': section_lines[:header_end]})

    i = header_end
    while i < len(section_lines):
        line = section_lines[i]
        m = SESSION_RE.match(line)
        if m:
            checkin_num = int(m.group(1))
            # Collect from this line until (and including) the next "---" separator
            block_lines = []
            j = i
            while j < len(section_lines):
                block_lines.append(section_lines[j])
                if section_lines[j] == '---':
                    j += 1
                    break
                j += 1
            # Consume any blank lines after the "---" that belong to the gap
            # (we'll attach them to the block so they get archived/removed together)
            while j < len(section_lines) and section_lines[j] == '':
                block_lines.append(section_lines[j])
                j += 1
            items.append({'type': 'block', 'lines': block_lines, 'checkin': checkin_num})
            i = j
        else:
            # Lines between end of last block and next block or end of section
            # Accumulate as a tail
            tail_lines = []
            while i < len(section_lines) and not SESSION_RE.match(section_lines[i]):
                tail_lines.append(section_lines[i])
                i += 1
            if tail_lines:
                items.append({'type': 'tail', 'lines': tail_lines})

    return items

# Parse all TF sections
parsed_sections = []
for (sec_start, sec_end) in tf_sections:
    section_lines = lines[sec_start:sec_end + 1]
    parsed = parse_tf_section(section_lines, sec_start)
    parsed_sections.append({'start': sec_start, 'end': sec_end, 'items': parsed})

# ---------------------------------------------------------------------------
# Step 3: Collect archive blocks and rebuild TF section content.
# ---------------------------------------------------------------------------

archive_blocks = []     # list of line-lists (check-ins 1–240)
ARCHIVE_CUTOFF = 240

def rebuild_tf_section(items, section_header_line):
    """
    Given parsed items for a TF section, return:
      - new_lines: lines to put in NEXUS.md for this section
      - arch_blocks: list of block line-lists for the archive
    """
    arch_blocks = []
    keep_blocks = []

    for item in items:
        if item['type'] == 'block':
            if item['checkin'] <= ARCHIVE_CUTOFF:
                arch_blocks.append(item['lines'])
            else:
                keep_blocks.append(item)

    # Build new section lines
    header_item = next((x for x in items if x['type'] == 'header'), None)
    tail_item   = next((x for x in items if x['type'] == 'tail'), None)

    new_lines = []
    new_lines.append(section_header_line)  # "## Team Feedback"
    new_lines.append('')                    # blank line after header

    if not keep_blocks:
        # Section is now empty — add placeholder
        new_lines.append('> Check-ins 1–240 archived to NEXUS-checkins-archive-2026-Q1.md on 2026-03-31.')
        new_lines.append('')
    else:
        for block_item in keep_blocks:
            new_lines.extend(block_item['lines'])
        if tail_item:
            new_lines.extend(tail_item['lines'])

    return new_lines, arch_blocks

# ---------------------------------------------------------------------------
# Step 4: Reconstruct the full NEXUS content.
#         Sections outside TF sections are kept byte-for-byte.
# ---------------------------------------------------------------------------

# Build a set of line index ranges occupied by TF sections
tf_ranges = {(s['start'], s['end']) for s in parsed_sections}

# Build the new file by going line by line, replacing TF sections
new_lines = []
i = 0
all_arch_blocks = []

# Map from start index to parsed section
tf_by_start = {s['start']: s for s in parsed_sections}

while i < n:
    if i in tf_by_start:
        sec = tf_by_start[i]
        sec_header_line = lines[i]   # "## Team Feedback"
        new_sec_lines, arch_blocks = rebuild_tf_section(sec['items'], sec_header_line)
        all_arch_blocks.extend(arch_blocks)
        new_lines.extend(new_sec_lines)
        i = sec['end'] + 1
    else:
        new_lines.append(lines[i])
        i += 1

# ---------------------------------------------------------------------------
# Step 5: Write archive file.
# ---------------------------------------------------------------------------

ARCHIVE_HEADER = (
    '# NEXUS Check-in Archive — 2026 Q1 (check-ins 1–240)\n\n'
    '> Archived from NEXUS.md on 2026-03-31. Contains check-ins 1–240.\n\n'
    '---\n\n'
)

with open(ARCHIVE_PATH, 'w', encoding='utf-8') as f:
    f.write(ARCHIVE_HEADER)
    for block_lines in all_arch_blocks:
        f.write('\n'.join(block_lines))
        # Ensure blocks are separated; trailing blank lines are already in block_lines
        if block_lines and block_lines[-1] != '':
            f.write('\n')

print(f"\nArchive written: {ARCHIVE_PATH}")

# ---------------------------------------------------------------------------
# Step 6: Write updated NEXUS.md.
# ---------------------------------------------------------------------------

new_content = '\n'.join(new_lines)
with open(NEXUS_PATH, 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f"NEXUS.md rewritten: {NEXUS_PATH}")

# ---------------------------------------------------------------------------
# Step 7: Verification counts.
# ---------------------------------------------------------------------------

with open(NEXUS_PATH, 'r', encoding='utf-8') as f:
    nexus_new = f.read()
with open(ARCHIVE_PATH, 'r', encoding='utf-8') as f:
    archive_content = f.read()

nexus_sessions = re.findall(r'^> Session:.*\(check-in (\d+)\)', nexus_new, re.MULTILINE)
archive_sessions = re.findall(r'^> Session:.*\(check-in (\d+)\)', archive_content, re.MULTILINE)

nexus_checkin_nums = sorted(int(x) for x in nexus_sessions)
archive_checkin_nums = sorted(int(x) for x in archive_sessions)

print(f"\n=== VERIFICATION ===")
print(f"Archive check-in count : {len(archive_checkin_nums)}")
if archive_checkin_nums:
    print(f"  Range: {archive_checkin_nums[0]}–{archive_checkin_nums[-1]}")
    unexpected_in_archive = [x for x in archive_checkin_nums if x > ARCHIVE_CUTOFF]
    if unexpected_in_archive:
        print(f"  WARNING: found check-ins > {ARCHIVE_CUTOFF} in archive: {unexpected_in_archive}")
    else:
        print(f"  All <= {ARCHIVE_CUTOFF} ✓")

print(f"Live check-in count    : {len(nexus_checkin_nums)}")
if nexus_checkin_nums:
    print(f"  Range: {nexus_checkin_nums[0]}–{nexus_checkin_nums[-1]}")
    unexpected_in_nexus = [x for x in nexus_checkin_nums if x <= ARCHIVE_CUTOFF]
    if unexpected_in_nexus:
        print(f"  WARNING: found check-ins <= {ARCHIVE_CUTOFF} still in NEXUS: {unexpected_in_nexus}")
    else:
        print(f"  All > {ARCHIVE_CUTOFF} ✓")

nexus_line_count = len(nexus_new.split('\n'))
print(f"New NEXUS.md line count: {nexus_line_count}")
print(f"Archive file line count: {len(archive_content.split(chr(10)))}")
