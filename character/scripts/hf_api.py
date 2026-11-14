import sys
from gradio_client import Client
c = Client(sys.argv[1])
print(c.view_api(return_format="str") if hasattr(c, "view_api") else "")
