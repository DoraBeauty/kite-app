
def check_braces(filename):
    with open(filename, 'r') as f:
        content = f.read()

    # Extract script content (roughly)
    start = content.find('<script type="module">')
    if start == -1:
        print("No module script found")
        return

    end = content.rfind('</script>')
    script = content[start:end]

    stack = []
    lines = script.split('\n')
    for i, line in enumerate(lines):
        for char in line:
            if char == '{':
                stack.append((char, i + 1))
            elif char == '}':
                if not stack:
                    print(f"Extra closing brace at line {i + 1} (relative to script start)")
                    return
                stack.pop()

    if stack:
        print(f"Unclosed brace at line {stack[-1][1]} (relative to script start)")
    else:
        print("Braces are balanced")

check_braces('index.html')
