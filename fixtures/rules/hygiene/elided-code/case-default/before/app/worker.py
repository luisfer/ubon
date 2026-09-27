import time


def run(queue):
    while True:
        job = queue.get()
        if job is None:
            break
        job.execute()
        time.sleep(0.1)
