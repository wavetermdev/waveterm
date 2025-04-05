import pandas as pd
import difflib
import json

# Sample acronym dictionary
acronym_dict = {
    "COU": ["Change Of Use", "Center of the Universe"],
    "UOC": ["Universitat Oberta de Catalunya"]
}

# Function to flip an acronym
def flip_acronym(acronym):
    return acronym[::-1]

# Function to find matches for an acronym
def find_matches(acronym, acronym_dict):
    flipped = flip_acronym(acronym)
    original_matches = acronym_dict.get(acronym, [])
    flipped_matches = acronym_dict.get(flipped, [])
    return original_matches, flipped_matches

# Example usage
acronym = "COU"
flipped_acronym = flip_acronym(acronym)
original_matches, flipped_matches = find_matches(acronym, acronym_dict)

print(f"Flipped: {flipped_acronym}")
print("Matches Found:")
print(f"- {acronym}: {', '.join(original_matches)}")
print(f"- {flipped_acronym}: {', '.join(flipped_matches)}")
