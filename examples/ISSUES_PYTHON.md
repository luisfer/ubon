# Python Example – Introduced Issues

This example intentionally includes the following findings for reconciliation:

- PYSEC002: exec()
- PYSEC003: eval()
- PYSEC004: subprocess with shell=True
- PYSEC005: yaml.load() unsafe without Loader
- PYSEC006: pickle.load/loads on untrusted input
- PYSEC007: requests.verify=False
- PYNET001: requests call without timeout
- PYSEC009: DEBUG=True
- PYSEC010: ALLOWED_HOSTS includes *
