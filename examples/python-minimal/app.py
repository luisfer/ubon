# Intentional issues documented in ../ISSUES_PYTHON.md
import requests
import yaml

DEBUG = True
ALLOWED_HOSTS = ['*']

resp = requests.get('https://example.com')  # no timeout
print(resp.status_code)

# Unsafe yaml.load
cfg = yaml.load('key: value')
