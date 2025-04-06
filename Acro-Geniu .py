[![Docsite and Storybook CI/CD](https://github.com/coders33123/waveterm/actions/workflows/deploy-docsite.yml/badge.svg)](https://github.com/coders33123/waveterm/actions/workflows/deploy-docsite.yml)
import ast

def analyze_code(code: str) -> dict:
    """
    Analyzes Python code and extracts information about functions, classes, etc.
    """
    tree = ast.parse(code)
    info = {"functions": [], "classes": [], "variables": []}

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            function_info = {
                "name": node.name,
                "args": [arg.arg for arg in node.args.args],
                "return_type": None,  # Needs further analysis
            }
            info["functions"].append(function_info)
        elif isinstance(node, ast.ClassDef):
            class_info = {"name": node.name, "methods": []}
            for body_node in node.body:
                if isinstance(body_node, ast.FunctionDef):
                    class_info["methods"].append(body_node.name)
            info["classes"].append(class_info)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    var_info = {"name": target.id, "type": None}  # Needs further analysis
                    info["variables"].append(var_info)
    return info

# Example usage
code_snippet = """
def greet(name: str) -> str:
    return f"Hello, {name}!"

class MyClass:
    def __init__(self, x: int):
        self.x = x

    def my_method(self):
        return self.x * 2

my_var = 10
"""

analysis_result = analyze_code(code_snippet)
print(analysis_result)
