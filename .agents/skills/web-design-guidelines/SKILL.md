---
name: web-design-guidelines
description: Build and review advanced UI code with topmost animations while maintaining low token output. Use when asked to "review my UI", "create advanced animations", "audit design", "review UX", or "build top-tier UI components".
metadata:
  author: vercel
  version: "2.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines & Advanced UI

Review or build files for compliance with Web Interface Guidelines, focusing on advanced UI paradigms, top-tier animations, and extreme token efficiency.

## How It Works

1. Combine the latest web interface guidelines with high-performance animation practices.
2. Read the specified files (or prompt user for files/pattern).
3. Check or build UI against rules, applying extreme token efficiency (reusable components, atomic classes, minimal boilerplate).
4. For reviews, output findings in a terse `file:line` format. For generation, provide concise, modular code using modern libraries (like Framer Motion or CSS keyframes).

## Core Principles

- **Topmost Animations**: Use hardware-accelerated CSS (`transform`, `opacity`) or lightweight animation wrappers (e.g., Framer Motion with lazy loading, or raw CSS animations) for butter-smooth micro-interactions.
- **Low Token Usage**:
  - Produce minimal, highly modular code.
  - Rely on existing UI libraries (like shadcn/ui and tailwindcss) instead of writing custom styles from scratch.
  - Omit repetitive boilerplate when explaining or updating code.
- **Advanced UI Design**: Implement modern patterns such as glassmorphism, contextual shadows, dynamic layouts, and highly interactive hover states.

## Guidelines Source

Fetch fresh baseline guidelines before each review:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Use WebFetch to retrieve the latest rules. Merge these with the Core Principles above to audit or produce code.

## Usage

When a user provides a file or pattern argument:
1. Fetch guidelines from the source URL above.
2. Read the specified files.
3. Apply all rules from the fetched guidelines AND the Advanced UI / Animation principles.
4. Output findings using the format specified in the guidelines, or generate highly concise component code.
