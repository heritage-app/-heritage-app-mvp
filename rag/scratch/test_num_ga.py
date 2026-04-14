from app.rag.utils import num_to_ga

n = 50
ga_val = num_to_ga(n)
print(f"Number: {n}")
print(f"Ga: {ga_val}")

# Test a few other variants to be sure
for i in [1, 10, 15, 50, 55, 99]:
    print(f"{i} -> {num_to_ga(i)}")
