def charge(amount):
    if amount <= 0:
        raise ValueError("amount must be positive")
    return {"charged": amount}
