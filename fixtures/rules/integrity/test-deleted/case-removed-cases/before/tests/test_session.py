from app.session import login, logout


class TestSession:
    def test_login(self):
        assert login("ada", "secret-for-tests")

    def test_rejects_bad_password(self):
        assert not login("ada", "nope")

    def test_logout(self):
        result = logout("ada")
        assert result is True
