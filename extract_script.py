import re
import sys

def check_syntax():
    with open("index.html", "r") as f:
        content = f.read()

    # Find the module script
    match = re.search(r'<script type="module">([\s\S]*?)</script>', content)
    if not match:
        print("No module script found")
        return

    script_content = match.group(1)

    # Write to a temp file
    with open("temp_script.js", "w") as f:
        f.write(script_content)

    print("Script extracted to temp_script.js")

if __name__ == "__main__":
    check_syntax()
