# Acknowledgements

The following sets forth attribution notices for third party software that may be contained in portions of the Wave Terminal product.
{{ range . }}
## {{ .Name }}

* Name: {{ .Name }}
* Version: {{ .Version }}
* License: [{{ .LicenseName }}]({{ .LicenseURL }})

```txt
{{ .LicenseText }}
```

-----
{{ end }}