import pytest

from app.billing import charge


def test_charge():
    assert charge(5) == {"charged": 5}


def test_rejects_zero():
    with pytest.raises(ValueError):
        charge(0)
