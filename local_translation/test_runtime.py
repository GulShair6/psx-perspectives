import unittest
from runtime import split_text, validate


class RuntimeTests(unittest.TestCase):
    def test_no_source_loss(self):
        text = 'اگر قیمت 100 ہو۔ Do not buy 200. ' * 100
        pieces = split_text(text, lambda t: len(t) <= 40)
        self.assertEqual(''.join(pieces), text)
        self.assertTrue(all(len(p) <= 40 for p in pieces))

    def test_numbers(self):
        validate('قیمت 1,200.50 اور 10%', 'Price 1,200.50 and 10%')
        for out in ['Price 1200.50 and 10%', 'Price 1,200.50', '', 'Price 1,200.50 and 20%']:
            with self.assertRaises(ValueError):
                validate('قیمت 1,200.50 اور 10%', out)


if __name__ == '__main__':
    unittest.main()
